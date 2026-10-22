"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import {
    calculateCarSettlement,
    type SettlementPeriod,
    type SettlementTransfer,
} from "@/lib/car-settlement";
import { getCarSettlementSnapshot } from "@/lib/car-settlement-snapshot";
import { loadCarTripPayers } from "@/lib/car-trip-payers-server";

type Result =
    | { success: true }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };

type StartpointRow = {
    tank_date: string;
    odometer: number;
};

type TripRow = {
    id: string;
    driver_id: string;
    driver_name: string;
    start_odometer: number;
    end_odometer: number;
};

type RefuelRow = {
    id: string;
    paid_by: string;
    payer_name: string;
    tank_date: string;
    odometer: number;
    amount_cents: number;
    settled_at: Date | null;
};

export type StatementSnapshot = {
    version: 1;
    completedByName: string;
    periods: SettlementPeriod[];
    transfers: SettlementTransfer[];
};

export type StatementHistoryItem = {
    id: string;
    created_at: string;
    reopened_at: string | null;
    snapshot: StatementSnapshot;
};

type HistoryResult =
    | {
        success: true;
        total: number;
        items: StatementHistoryItem[];
    }
    | { success: false; error: string };

class SettlementValidationError extends Error {
    constructor(
        message: string,
        public readonly refreshRequired = false,
    ) {
        super(message);
    }
}

function validId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 128
    );
}

function validUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value,
        )
    );
}

async function loadSettlement(
    client: PoolClient,
    organizationId: string,
) {
    const startpointResult = await client.query<StartpointRow>(
        `
        SELECT tank_date::text AS tank_date, odometer
        FROM public.car_startpoint
        WHERE organization_id = $1
        FOR SHARE
        `,
        [organizationId],
    );

    const startpoint = startpointResult.rows[0];

    if (!startpoint) {
        throw new SettlementValidationError(
            "Het startpunt van deze auto ontbreekt.",
        );
    }

    const refuelResult = await client.query<RefuelRow>(
        `
        SELECT
            refuel.id,
            paid_by,
            payer.name AS payer_name,
            tank_date::text AS tank_date,
            odometer,
            amount_cents,
            settled_at
        FROM public.car_refuel AS refuel
        JOIN public."user" AS payer ON payer.id = refuel.paid_by
        WHERE organization_id = $1
        ORDER BY odometer ASC
        FOR UPDATE OF refuel
        `,
        [organizationId],
    );

    const tripResult = await client.query<TripRow>(
        `
        SELECT
            trip.id,
            driver_id,
            driver.name AS driver_name,
            start_odometer,
            end_odometer
        FROM public.car_trip AS trip
        JOIN public."user" AS driver ON driver.id = trip.driver_id
        WHERE organization_id = $1
        ORDER BY start_odometer ASC
        FOR SHARE OF trip
        `,
        [organizationId],
    );

    const payerMap = await loadCarTripPayers(
        client,
        organizationId,
        tripResult.rows.map((trip) => trip.id),
    );

    const source = {
        startpoint: {
            tankDate: startpoint.tank_date,
            odometer: startpoint.odometer,
        },
        trips: tripResult.rows.map((trip) => ({
            driverId: trip.driver_id,
            driverName: trip.driver_name,
            payers: payerMap.get(trip.id),
            startOdometer: trip.start_odometer,
            endOdometer: trip.end_odometer,
        })),
        refuels: refuelResult.rows.map((refuel) => ({
            id: refuel.id,
            paidBy: refuel.paid_by,
            payerName: refuel.payer_name,
            tankDate: refuel.tank_date,
            odometer: refuel.odometer,
            amountCents: refuel.amount_cents,
            settledAt: refuel.settled_at?.toISOString() ?? null,
        })),
    };

    return {
        ...calculateCarSettlement(
            source.startpoint,
            source.trips,
            source.refuels,
        ),
        source,
    };
}

async function saveHistory(
    client: PoolClient,
    organizationId: string,
    userId: string,
    loaded: Awaited<ReturnType<typeof loadSettlement>>,
    ids: string[],
) {
    const included = new Set(ids);

    // Alle tankbeurten blijven als periodegrens bestaan.
    // Alleen de geselecteerde periodes tellen mee voor dit archief.
    const selected = calculateCarSettlement(
        loaded.source.startpoint,
        loaded.source.trips,
        loaded.source.refuels.map((refuel) => ({
            ...refuel,
            settledAt: included.has(refuel.id)
                ? null
                : refuel.settledAt ?? "2000-01-01T00:00:00.000Z",
        })),
    );

    const actor = await client.query<{ name: string }>(
        'SELECT name FROM public."user" WHERE id = $1',
        [userId],
    );

    const snapshot: StatementSnapshot = {
        version: 1,
        completedByName: actor.rows[0]?.name ?? "Onbekende gebruiker",
        periods: selected.periods.filter(
            (period) => period.status === "complete",
        ),
        transfers: selected.transfers,
    };

    if (snapshot.periods.length !== ids.length) {
        throw new SettlementValidationError(
            "De afrekening is veranderd. Vernieuw de pagina.",
            true,
        );
    }

    await client.query(
        `
        INSERT INTO public.car_statement_history (
            organization_id,
            created_by,
            period_ids,
            snapshot
        )
        VALUES ($1, $2, $3::uuid[], $4::jsonb)
        `,
        [organizationId, userId, ids, JSON.stringify(snapshot)],
    );
}

async function changeSettlement(
    organizationId: string,
    change: (client: PoolClient, userId: string) => Promise<void>,
): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (!validId(organizationId)) {
        return { success: false, error: "Ongeldige auto." };
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;

    try {
        client = await db.connect();

        await client.query("BEGIN");
        transactionOpen = true;

        const organization = await client.query(
            `
            SELECT id
            FROM public.organization
            WHERE id = $1
            FOR UPDATE
            `,
            [organizationId],
        );

        if (organization.rowCount !== 1) {
            throw new SettlementValidationError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const membership = await client.query<{ role: string }>(
            `
            SELECT role
            FROM public.member
            WHERE "organizationId" = $1
                AND "userId" = $2
            FOR SHARE
            `,
            [organizationId, session.user.id],
        );

        const member = membership.rows[0];

        const isOwner =
            member?.role
                .split(",")
                .map((role) => role.trim())
                .includes("owner") ?? false;

        if (!isOwner) {
            throw new SettlementValidationError(
                "Alleen eigenaars kunnen tankperiodes afronden of opnieuw openen.",
            );
        }

        await change(client, session.user.id);

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (!(error instanceof SettlementValidationError)) {
            logServerError("changeSettlement", error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError("changeSettlement.rollback", rollbackError);
            }
        }

        if (error instanceof SettlementValidationError) {
            return {
                success: false,
                error: error.message,
                refreshRequired: error.refreshRequired,
            };
        }

        return {
            success: false,
            error: "De afrekening kon niet worden bijgewerkt. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }

    revalidatePath(`/auto/${organizationId}`);

    return { success: true };
}

export async function setCarPeriodSettled(
    organizationId: string,
    refuelId: string,
    settled: boolean,
): Promise<Result> {
    if (!validUuid(refuelId) || typeof settled !== "boolean") {
        return { success: false, error: "Ongeldige tankperiode." };
    }

    return changeSettlement(organizationId, async (client, userId) => {
        const settlement = await loadSettlement(client, organizationId);

        const period = [
            ...settlement.periods,
            ...settlement.settledPeriods,
        ].find((entry) => entry.id === refuelId);

        if (!period) {
            throw new SettlementValidationError(
                "Deze tankperiode bestaat niet meer. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        if (settled) {
            if (period.settledAt !== null) return;

            if (period.status !== "complete") {
                throw new SettlementValidationError(
                    "Deze tankperiode is nog onvolledig. Het overzicht wordt vernieuwd.",
                    true,
                );
            }

            await saveHistory(
                client,
                organizationId,
                userId,
                settlement,
                [refuelId],
            );

            await client.query(
                `
                UPDATE public.car_refuel
                SET
                    settled_at = NOW(),
                    settled_by = $3,
                    updated_at = clock_timestamp()
                WHERE organization_id = $1
                    AND id = $2
                    AND settled_at IS NULL
                `,
                [organizationId, refuelId, userId],
            );
        } else {
            if (period.settledAt === null) return;

            await client.query(
                `
                UPDATE public.car_statement_history
                SET reopened_at = clock_timestamp()
                WHERE organization_id = $1
                    AND $2::uuid = ANY(period_ids)
                    AND reopened_at IS NULL
                `,
                [organizationId, refuelId],
            );

            await client.query(
                `
                UPDATE public.car_refuel
                SET
                    settled_at = NULL,
                    settled_by = NULL,
                    updated_at = clock_timestamp()
                WHERE organization_id = $1
                    AND id = $2
                `,
                [organizationId, refuelId],
            );
        }
    });
}

export async function settleCarStatement(
    organizationId: string,
    expectedSnapshot: string,
): Promise<Result> {
    if (
        typeof expectedSnapshot !== "string" ||
        expectedSnapshot.length === 0 ||
        expectedSnapshot.length > 2_000_000
    ) {
        return {
            success: false,
            error:
                "Het overzicht kon niet worden gecontroleerd. Vernieuw de pagina.",
            refreshRequired: true,
        };
    }

    return changeSettlement(organizationId, async (client, userId) => {
        const settlement = await loadSettlement(client, organizationId);

        const completePeriods = settlement.periods.filter(
            (period) => period.status === "complete",
        );

        if (completePeriods.length === 0) {
            throw new SettlementValidationError(
                "Er zijn geen volledige open tankperiodes meer. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        const actualSnapshot = getCarSettlementSnapshot(settlement.periods);

        if (actualSnapshot !== expectedSnapshot) {
            throw new SettlementValidationError(
                "De afrekening is ondertussen veranderd. Het overzicht wordt vernieuwd. Controleer de bedragen voordat je opnieuw afrondt.",
                true,
            );
        }

        const ids = completePeriods.map((period) => period.id);

        await saveHistory(client, organizationId, userId, settlement, ids);

        const result = await client.query(
            `
            UPDATE public.car_refuel
            SET
                settled_at = NOW(),
                settled_by = $3,
                updated_at = clock_timestamp()
            WHERE organization_id = $1
                AND id = ANY($2::uuid[])
                AND settled_at IS NULL
            `,
            [organizationId, ids, userId],
        );

        if (result.rowCount !== ids.length) {
            throw new SettlementValidationError(
                "De afrekening is ondertussen veranderd. Het overzicht wordt vernieuwd.",
                true,
            );
        }
    });
}

export async function getCarStatementHistory(
    organizationId: string,
    page: number,
): Promise<HistoryResult> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (
        !validId(organizationId) ||
        !Number.isInteger(page) ||
        page < 0 ||
        page > 1_000_000
    ) {
        return { success: false, error: "Ongeldige pagina of auto." };
    }

    try {
        const result = await db.query<{
            authorized: boolean;
            total: number;
            items: StatementHistoryItem[];
        }>(
            `
            WITH access AS (
                SELECT 1
                FROM public.member
                WHERE "organizationId" = $1
                    AND "userId" = $2
            ), history AS (
                SELECT id, created_at, reopened_at, snapshot
                FROM public.car_statement_history
                WHERE organization_id = $1
                    AND EXISTS (SELECT 1 FROM access)
            ), page AS (
                SELECT *
                FROM history
                ORDER BY created_at DESC, id DESC
                LIMIT 5 OFFSET $3
            )
            SELECT
                EXISTS (SELECT 1 FROM access) AS authorized,
                (SELECT COUNT(*)::integer FROM history) AS total,
                COALESCE(
                    (
                        SELECT jsonb_agg(
                            to_jsonb(page)
                            ORDER BY created_at DESC, id DESC
                        )
                        FROM page
                    ),
                    '[]'::jsonb
                ) AS items
            `,
            [organizationId, session.user.id, page * 5],
        );

        const row = result.rows[0];

        if (!row?.authorized) {
            return {
                success: false,
                error: "Je hebt geen toegang tot deze auto.",
            };
        }

        return {
            success: true,
            total: row.total,
            items: row.items,
        };
    } catch (error) {
        logServerError("getCarStatementHistory", error);

        return {
            success: false,
            error: "De afrekenhistoriek kon niet worden geladen. Probeer opnieuw.",
        };
    }
}