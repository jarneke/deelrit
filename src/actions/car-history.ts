"use server";

import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import type {
    HistoryResult,
    HistoryStartpoint,
    RefuelHistoryEntry,
    TripHistoryItem,
} from "@/lib/car-history-types";

type HistoryKind = "trips" | "refuels";

type StartpointRow = {
    tank_date: string;
    odometer: number;
};

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

type PageContext = {
    client: PoolClient;
    organizationId: string;
    offset: number;
    pageSize: number;
    recordCount: number;
    startpoint: HistoryStartpoint | null;
};

class HistoryAccessError extends Error { }

function validOrganizationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 128
    );
}

function validPage(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 1_000_000
    );
}

async function loadHistoryPage<T>(
    organizationId: string,
    requestedPage: number,
    kind: HistoryKind,
    loadItems: (context: PageContext) => Promise<T[]>,
): Promise<HistoryResult<T>> {
    if (
        !validOrganizationId(organizationId) ||
        !validPage(requestedPage)
    ) {
        return {
            success: false,
            error: "Ongeldige auto of pagina.",
        };
    }

    const actionName =
        kind === "trips"
            ? "getCarTripHistoryPage"
            : "getCarRefuelHistoryPage";

    let client: PoolClient | undefined;
    let transactionOpen = false;

    try {
        const session = await getSession();

        if (!session) {
            return {
                success: false,
                error: "Log eerst in.",
            };
        }

        client = await db.connect();

        // Lidmaatschap, telling en pagina gebruiken dezelfde database-snapshot.
        await client.query(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        transactionOpen = true;

        const membership = await client.query(
            `
        SELECT id
        FROM public.member
        WHERE "organizationId" = $1
          AND "userId" = $2
        LIMIT 1
      `,
            [organizationId, session.user.id],
        );

        if (membership.rowCount !== 1) {
            throw new HistoryAccessError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const startpointResult = await client.query<StartpointRow>(
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

        // De tabelnaam komt uitsluitend uit deze interne vaste keuze.
        const table =
            kind === "trips"
                ? "public.car_trip"
                : "public.car_refuel";

        const countResult = await client.query<{ total: string }>(
            `
        SELECT COUNT(*)::text AS total
        FROM ${table}
        WHERE organization_id = $1
      `,
            [organizationId],
        );

        const recordCount = Number(countResult.rows[0].total);

        if (!Number.isSafeInteger(recordCount) || recordCount < 0) {
            throw new Error("Ongeldige telling van geschiedenisgegevens.");
        }

        const includesStartpoint =
            kind === "refuels" && startpoint !== null;

        const total = recordCount + (includesStartpoint ? 1 : 0);
        const pageSize = kind === "trips" ? 10 : 5;
        const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
        const page = Math.min(requestedPage, lastPage);
        const offset = page * pageSize;

        const items = await loadItems({
            client,
            organizationId,
            offset,
            pageSize,
            recordCount,
            startpoint,
        });

        await client.query("COMMIT");
        transactionOpen = false;

        return {
            success: true,
            data: {
                items,
                total,
                page,
                pageSize,
            },
        };
    } catch (error) {
        if (!(error instanceof HistoryAccessError)) {
            logServerError(actionName, error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(`${actionName}.rollback`, rollbackError);
            }
        }

        return {
            success: false,
            error:
                error instanceof HistoryAccessError
                    ? error.message
                    : "De geschiedenis kon niet worden geladen. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }
}

export async function getCarTripHistoryPage(
    organizationId: string,
    page: number,
): Promise<HistoryResult<TripHistoryItem>> {
    return loadHistoryPage<TripHistoryItem>(
        organizationId,
        page,
        "trips",
        async ({
            client,
            organizationId,
            offset,
            pageSize,
            startpoint,
        }) => {
            if (!startpoint) {
                return [];
            }

            const result = await client.query<TripRow>(
                `
          WITH periods AS (
            SELECT
              odometer AS end_odometer,
              lag(odometer, 1, $2::integer) OVER (
                ORDER BY odometer ASC
              ) AS start_odometer,
              settled_at
            FROM public.car_refuel
            WHERE organization_id = $1
          )
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
          WHERE trip.organization_id = $1
          ORDER BY
            trip.start_odometer DESC,
            trip.end_odometer DESC,
            trip.id DESC
          LIMIT $3 OFFSET $4
        `,
                [
                    organizationId,
                    startpoint.odometer,
                    pageSize,
                    offset,
                ],
            );

            return result.rows.map((trip) => ({
                id: trip.id,
                driverId: trip.driver_id,
                driverName: trip.driver_name,
                createdBy: trip.created_by,
                version: trip.version,
                tripDate: trip.trip_date,
                endedAt: trip.ended_at?.toISOString() ?? null,
                startOdometer: trip.start_odometer,
                endOdometer: trip.end_odometer,
                description: trip.description,
                settledLocked: trip.settled_locked,
            }));
        },
    );
}

export async function getCarRefuelHistoryPage(
    organizationId: string,
    page: number,
): Promise<HistoryResult<RefuelHistoryEntry>> {
    return loadHistoryPage<RefuelHistoryEntry>(
        organizationId,
        page,
        "refuels",
        async ({
            client,
            organizationId,
            offset,
            pageSize,
            recordCount,
            startpoint,
        }) => {
            const result = await client.query<RefuelRow>(
                `
          WITH ordered_refuels AS (
            SELECT
              refuel.id,
              refuel.paid_by,
              refuel.created_by,
              refuel.updated_at::text AS version,
              refuel.tank_date::text AS tank_date,
              refuel.odometer,
              refuel.amount_cents,
              refuel.settled_at,
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
          )
          SELECT
            ordered_refuels.*,
            payer.name AS payer_name
          FROM ordered_refuels
          JOIN public."user" AS payer
            ON payer.id = ordered_refuels.paid_by
          ORDER BY
            ordered_refuels.odometer DESC,
            ordered_refuels.id DESC
          LIMIT $2 OFFSET $3
        `,
                [organizationId, pageSize, offset],
            );

            const entries: RefuelHistoryEntry[] = result.rows.map(
                (refuel) => ({
                    kind: "refuel",
                    refuel: {
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
                    },
                }),
            );

            // Het startpunt staat direct na de laatste echte tankbeurt.
            if (
                startpoint &&
                recordCount >= offset &&
                recordCount < offset + pageSize
            ) {
                entries.push({
                    kind: "startpoint",
                    startpoint,
                });
            }

            return entries;
        },
    );
}