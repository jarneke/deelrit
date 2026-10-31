"use server";

import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import { loadCarTripPayers } from "@/lib/car-trip-payers-server";
import type {
    HistoryStartpoint,
    RefuelHistoryItem,
    TripHistoryItem,
} from "@/lib/car-history-types";
import type {
    HistoryBrowserFilters,
    HistoryBrowserPerson,
    HistoryBrowserResult,
    HistoryBrowserSort,
} from "@/lib/car-history-browser-types";

type TripRow = {
    id: string;
    driver_id: string;
    driver_name: string;
    created_by: string;
    version: string;
    trip_date: string;
    ended_at: Date | null;
    start_odometer: number;
    end_odometer: number;
    description: string;
    settled_locked: boolean;
};

type RefuelRow = {
    id: string;
    paid_by: string;
    payer_name: string;
    created_by: string;
    version: string;
    tank_date: string;
    odometer: number;
    amount_cents: number;
    settled_at: Date | null;
    next_tank_date: string | null;
    next_settled_at: Date | null;
};

class HistoryBrowserError extends Error { }

const sortOrders: Record<HistoryBrowserSort, string> = {
    "date-desc": "record_date DESC, odometer DESC, id DESC",
    "date-asc": "record_date ASC, odometer ASC, id ASC",
    "odometer-desc": "odometer DESC, id DESC",
    "odometer-asc": "odometer ASC, id ASC",
    "value-desc": "record_value DESC, record_date DESC, id DESC",
    "value-asc": "record_value ASC, record_date DESC, id ASC",
};

const tripSource = `
  WITH periods AS (
    SELECT
      odometer AS end_odometer,
      lag(odometer, 1, $2::integer) OVER (
        ORDER BY odometer ASC
      ) AS start_odometer,
      settled_at
    FROM public.car_refuel
    WHERE organization_id = $1
  ),
  payer_groups AS (
    SELECT
      payer.trip_id,
      array_agg(
        CASE
          WHEN payer.user_id IS NOT NULL
            THEN 'member:' || payer.user_id
          ELSE 'guest:' || payer.guest_id::text
        END
        ORDER BY payer.position
      ) AS person_ids,
      array_agg(
        COALESCE(person.name, guest.name)
        ORDER BY payer.position
      ) AS person_names,
      string_agg(
        COALESCE(person.name, guest.name, ''),
        ' ' ORDER BY payer.position
      ) AS payer_names
    FROM public.car_trip_payer AS payer
    LEFT JOIN public."user" AS person
      ON person.id = payer.user_id
    LEFT JOIN public.car_guest AS guest
      ON guest.id = payer.guest_id
      AND guest.organization_id = payer.organization_id
    WHERE payer.organization_id = $1
    GROUP BY payer.trip_id
  ),
  records AS (
    SELECT
      trip.id,
      trip.driver_id,
      driver.name AS driver_name,
      trip.created_by,
      trip.updated_at::text AS version,
      trip.trip_date::text AS trip_date,
      trip.ended_at,
      trip.start_odometer,
      trip.end_odometer,
      trip.description,
      trip.trip_date AS record_date,
      trip.end_odometer AS odometer,
      trip.end_odometer - trip.start_odometer AS record_value,
      COALESCE(
        payers.person_ids,
        ARRAY['member:' || trip.driver_id]
      ) AS person_ids,
      COALESCE(
        payers.person_names,
        ARRAY[driver.name]
      ) AS person_names,
      concat_ws(
        ' ',
        driver.name,
        payers.payer_names,
        trip.description,
        trip.trip_date::text,
        trip.start_odometer::text,
        trip.end_odometer::text,
        (trip.end_odometer - trip.start_odometer)::text
      ) AS search_text,
      EXISTS (
        SELECT 1
        FROM periods
        WHERE periods.settled_at IS NOT NULL
          AND trip.start_odometer < periods.end_odometer
          AND trip.end_odometer > periods.start_odometer
      ) AS settled_locked
    FROM public.car_trip AS trip
    JOIN public."user" AS driver
      ON driver.id = trip.driver_id
    LEFT JOIN payer_groups AS payers
      ON payers.trip_id = trip.id
    WHERE trip.organization_id = $1
  )
`;

const refuelSource = `
  WITH ordered_refuels AS (
    SELECT
      refuel.*,
      $2::integer AS registration_start_odometer,
      (
        lead(refuel.tank_date) OVER (
          ORDER BY refuel.odometer ASC
        )
      )::text AS next_tank_date,
      lead(refuel.settled_at) OVER (
        ORDER BY refuel.odometer ASC
      ) AS next_settled_at
    FROM public.car_refuel AS refuel
    WHERE refuel.organization_id = $1
  ),
  records AS (
    SELECT
      refuel.id,
      refuel.paid_by,
      payer.name AS payer_name,
      refuel.created_by,
      refuel.updated_at::text AS version,
      refuel.tank_date::text AS tank_date,
      refuel.odometer,
      refuel.amount_cents,
      refuel.settled_at,
      refuel.next_tank_date,
      refuel.next_settled_at,
      refuel.tank_date AS record_date,
      refuel.amount_cents AS record_value,
      ARRAY['member:' || refuel.paid_by] AS person_ids,
      ARRAY[payer.name] AS person_names,
      concat_ws(
        ' ',
        payer.name,
        refuel.tank_date::text,
        refuel.odometer::text,
        refuel.amount_cents::text,
        (refuel.amount_cents::numeric / 100)::text,
        replace(
          (refuel.amount_cents::numeric / 100)::text,
          '.',
          ','
        )
      ) AS search_text,
      refuel.settled_at IS NOT NULL AS settled_locked
    FROM ordered_refuels AS refuel
    JOIN public."user" AS payer
      ON payer.id = refuel.paid_by
  )
`;

const filterClause = `
  WHERE (
    $3::text = ''
    OR strpos(lower(search_text), lower($3::text)) > 0
  )
  AND (
    $4::text = ''
    OR $4::text = ANY(person_ids)
  )
  AND ($5::date IS NULL OR record_date >= $5::date)
  AND ($6::date IS NULL OR record_date <= $6::date)
  AND (
    $7::text = 'all'
    OR ($7::text = 'settled' AND settled_locked)
    OR ($7::text = 'open' AND NOT settled_locked)
  )
`;

function validDate(value: string) {
    if (value === "") return true;

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value < "1900-01-01" ||
        value > "9998-12-31"
    ) {
        return false;
    }

    const date = new Date(value + "T12:00:00.000Z");

    return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
}

function parseFilters(input: unknown): HistoryBrowserFilters {
    if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input)
    ) {
        throw new HistoryBrowserError("Ongeldige historiekfilters.");
    }

    const value = input as Record<string, unknown>;

    if (value.kind !== "trips" && value.kind !== "refuels") {
        throw new HistoryBrowserError("Kies ritten of tankbeurten.");
    }

    const search = value.search ?? "";
    const person = value.person ?? "";
    const from = value.from ?? "";
    const to = value.to ?? "";
    const status = value.status ?? "all";
    const sort = value.sort ?? "date-desc";
    const page = value.page ?? 1;
    const pageSize = value.pageSize ?? 20;

    if (
        typeof search !== "string" ||
        search.length > 120 ||
        typeof person !== "string" ||
        person.length > 160 ||
        typeof from !== "string" ||
        typeof to !== "string" ||
        !validDate(from) ||
        !validDate(to) ||
        (from !== "" && to !== "" && from > to)
    ) {
        throw new HistoryBrowserError(
            "Controleer de zoekterm en het datumbereik.",
        );
    }

    if (
        status !== "all" &&
        status !== "open" &&
        status !== "settled"
    ) {
        throw new HistoryBrowserError("Ongeldige statusfilter.");
    }

    if (
        typeof sort !== "string" ||
        !Object.prototype.hasOwnProperty.call(sortOrders, sort)
    ) {
        throw new HistoryBrowserError("Ongeldige sortering.");
    }

    if (
        typeof page !== "number" ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 1_000_000
    ) {
        throw new HistoryBrowserError("Ongeldig paginanummer.");
    }

    if (
        pageSize !== 5 &&
        pageSize !== 10 &&
        pageSize !== 20 &&
        pageSize !== 50
    ) {
        throw new HistoryBrowserError(
            "Ongeldig aantal resultaten per pagina.",
        );
    }

    return {
        kind: value.kind,
        search: search.trim(),
        person,
        from,
        to,
        status,
        sort: sort as HistoryBrowserSort,
        page,
        pageSize,
    };
}

export async function searchCarHistory(
    organizationId: string,
    input: unknown,
): Promise<HistoryBrowserResult> {
    let client: PoolClient | undefined;
    let transactionOpen = false;

    try {
        if (
            typeof organizationId !== "string" ||
            organizationId.trim().length === 0 ||
            organizationId.length > 128
        ) {
            throw new HistoryBrowserError("Ongeldige auto.");
        }

        const filters = parseFilters(input);
        const session = await getSession();

        if (!session) {
            throw new HistoryBrowserError("Log eerst in.");
        }

        client = await db.connect();

        await client.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionOpen = true;

        const membership = await client.query<{ role: string }>(
            `
        SELECT role
        FROM public.member
        WHERE "organizationId" = $1
          AND "userId" = $2
        LIMIT 1
      `,
            [organizationId, session.user.id],
        );

        const member = membership.rows[0];

        if (!member) {
            throw new HistoryBrowserError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const startpointResult = await client.query<{
            tank_date: string;
            odometer: number;
        }>(
            `
        SELECT tank_date::text AS tank_date, odometer
        FROM public.car_startpoint
        WHERE organization_id = $1
      `,
            [organizationId],
        );

        const startpointRow = startpointResult.rows[0];

        const startpoint: HistoryStartpoint | null = startpointRow
            ? {
                tankDate: startpointRow.tank_date,
                odometer: startpointRow.odometer,
            }
            : null;

        const source =
            filters.kind === "trips" ? tripSource : refuelSource;

        const sourceParameters = [
            organizationId,
            startpoint?.odometer ?? 0,
        ];

        const parameters = [
            ...sourceParameters,
            filters.search,
            filters.person,
            filters.from || null,
            filters.to || null,
            filters.status,
        ];

        const peopleResult = await client.query<HistoryBrowserPerson>(
            `
        ${source}
        SELECT DISTINCT person.id, person.name
        FROM records
        CROSS JOIN LATERAL unnest(
          records.person_ids,
          records.person_names
        ) AS person(id, name)
        WHERE person.id IS NOT NULL
          AND person.name IS NOT NULL
        ORDER BY person.name, person.id
      `,
            sourceParameters,
        );

        const countResult = await client.query<{ total: string }>(
            `
        ${source}
        SELECT COUNT(*)::text AS total
        FROM records
        ${filterClause}
      `,
            parameters,
        );

        const total = Number(countResult.rows[0]?.total);

        if (!Number.isSafeInteger(total) || total < 0) {
            throw new Error("Ongeldige telling van historiekresultaten.");
        }

        const pageCount = Math.max(
            1,
            Math.ceil(total / filters.pageSize),
        );

        const page = Math.min(filters.page, pageCount);
        const offset = (page - 1) * filters.pageSize;

        const query = `
      ${source}
      SELECT *
      FROM records
      ${filterClause}
      ORDER BY ${sortOrders[filters.sort]}
      LIMIT $8 OFFSET $9
    `;

        const pageParameters = [
            ...parameters,
            filters.pageSize,
            offset,
        ];

        let trips: TripHistoryItem[] = [];
        let refuels: RefuelHistoryItem[] = [];

        if (filters.kind === "trips") {
            const result = await client.query<TripRow>(
                query,
                pageParameters,
            );

            const payerMap = await loadCarTripPayers(
                client,
                organizationId,
                result.rows.map((trip) => trip.id),
            );

            trips = result.rows.map((trip) => ({
                id: trip.id,
                driverId: trip.driver_id,
                driverName: trip.driver_name,
                payers: payerMap.get(trip.id),
                createdBy: trip.created_by,
                version: trip.version,
                tripDate: trip.trip_date,
                endedAt: trip.ended_at?.toISOString() ?? null,
                startOdometer: trip.start_odometer,
                endOdometer: trip.end_odometer,
                description: trip.description,
                settledLocked: trip.settled_locked,
            }));
        } else {
            const result = await client.query<RefuelRow>(
                query,
                pageParameters,
            );

            refuels = result.rows.map((refuel) => ({
                id: refuel.id,
                paidBy: refuel.paid_by,
                payerName: refuel.payer_name,
                createdBy: refuel.created_by,
                version: refuel.version,
                tankDate: refuel.tank_date,
                odometer: refuel.odometer,
                amountCents: refuel.amount_cents,
                settledAt: refuel.settled_at?.toISOString() ?? null,
                boundaryLocked: refuel.next_settled_at !== null,
                nextRefuel:
                    refuel.next_tank_date !== null
                        ? {
                            tankDate: refuel.next_tank_date,
                            settledAt:
                                refuel.next_settled_at?.toISOString() ?? null,
                        }
                        : null,
            }));
        }

        await client.query("COMMIT");
        transactionOpen = false;

        return {
            success: true,
            data: {
                filters: { ...filters, page },
                total,
                pageCount,
                trips,
                refuels,
                people: peopleResult.rows,
                startpoint,
                currentUserId: session.user.id,
                isOwner: member.role
                    .split(",")
                    .some((role) => role.trim() === "owner"),
            },
        };
    } catch (error) {
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(
                    "searchCarHistory.rollback",
                    rollbackError,
                );
            }
        }

        if (!(error instanceof HistoryBrowserError)) {
            logServerError("searchCarHistory", error);
        }

        return {
            success: false,
            error:
                error instanceof HistoryBrowserError
                    ? error.message
                    : "De historiek kon niet worden geladen. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }
}