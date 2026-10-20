"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { calculateCarSettlement } from "@/lib/car-settlement";
import { getCarSettlementSnapshot } from "@/lib/car-settlement-snapshot";

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
    driver_id: string;
    start_odometer: number;
    end_odometer: number;
};

type RefuelRow = {
    id: string;
    paid_by: string;
    tank_date: string;
    odometer: number;
    amount_cents: number;
    settled_at: Date | null;
};

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
    const startpointResult =
        await client.query<StartpointRow>(
            `
        SELECT
          tank_date::text AS tank_date,
          odometer
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

    const refuelResult =
        await client.query<RefuelRow>(
            `
        SELECT
          id,
          paid_by,
          tank_date::text AS tank_date,
          odometer,
          amount_cents,
          settled_at
        FROM public.car_refuel
        WHERE organization_id = $1
        ORDER BY odometer ASC
        FOR UPDATE
      `,
            [organizationId],
        );

    const tripResult =
        await client.query<TripRow>(
            `
        SELECT
          driver_id,
          start_odometer,
          end_odometer
        FROM public.car_trip
        WHERE organization_id = $1
        ORDER BY start_odometer ASC
        FOR SHARE
      `,
            [organizationId],
        );

    return calculateCarSettlement(
        {
            tankDate: startpoint.tank_date,
            odometer: startpoint.odometer,
        },
        tripResult.rows.map((trip) => ({
            driverId: trip.driver_id,
            driverName: trip.driver_id,
            startOdometer: trip.start_odometer,
            endOdometer: trip.end_odometer,
        })),
        refuelResult.rows.map((refuel) => ({
            id: refuel.id,
            paidBy: refuel.paid_by,
            payerName: refuel.paid_by,
            tankDate: refuel.tank_date,
            odometer: refuel.odometer,
            amountCents: refuel.amount_cents,
            settledAt:
                refuel.settled_at?.toISOString() ?? null,
        })),
    );
}

async function changeSettlement(
    organizationId: string,
    change: (
        client: PoolClient,
        userId: string,
    ) => Promise<void>,
): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return {
            success: false,
            error: "Log eerst in.",
        };
    }

    if (!validId(organizationId)) {
        return {
            success: false,
            error: "Ongeldige auto.",
        };
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

        const membership = await client.query<{
            role: string;
        }>(
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
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch {
                // De verbinding kan al verbroken zijn.
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
            error:
                "De afrekening kon niet worden bijgewerkt. Probeer opnieuw.",
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
    if (
        !validUuid(refuelId) ||
        typeof settled !== "boolean"
    ) {
        return {
            success: false,
            error: "Ongeldige tankperiode.",
        };
    }

    return changeSettlement(
        organizationId,
        async (client, userId) => {
            const settlement = await loadSettlement(
                client,
                organizationId,
            );

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
                if (period.settledAt !== null) {
                    return;
                }

                if (period.status !== "complete") {
                    throw new SettlementValidationError(
                        "Deze tankperiode is nog onvolledig. Het overzicht wordt vernieuwd.",
                        true,
                    );
                }

                await client.query(
                    `
            UPDATE public.car_refuel
            SET
              settled_at = NOW(),
              settled_by = $3,
              updated_at = NOW()
            WHERE organization_id = $1
              AND id = $2
              AND settled_at IS NULL
          `,
                    [organizationId, refuelId, userId],
                );
            } else {
                if (period.settledAt === null) {
                    return;
                }

                await client.query(
                    `
            UPDATE public.car_refuel
            SET
              settled_at = NULL,
              settled_by = NULL,
              updated_at = NOW()
            WHERE organization_id = $1
              AND id = $2
          `,
                    [organizationId, refuelId],
                );
            }
        },
    );
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

    return changeSettlement(
        organizationId,
        async (client, userId) => {
            const settlement = await loadSettlement(
                client,
                organizationId,
            );

            const completePeriods =
                settlement.periods.filter(
                    (period) => period.status === "complete",
                );

            if (completePeriods.length === 0) {
                throw new SettlementValidationError(
                    "Er zijn geen volledige open tankperiodes meer. Het overzicht wordt vernieuwd.",
                    true,
                );
            }

            const actualSnapshot =
                getCarSettlementSnapshot(
                    settlement.periods,
                );

            if (actualSnapshot !== expectedSnapshot) {
                throw new SettlementValidationError(
                    "De afrekening is ondertussen veranderd. Het overzicht wordt vernieuwd. Controleer de bedragen voordat je opnieuw afrondt.",
                    true,
                );
            }

            const ids = completePeriods.map(
                (period) => period.id,
            );

            const result = await client.query(
                `
          UPDATE public.car_refuel
          SET
            settled_at = NOW(),
            settled_by = $3,
            updated_at = NOW()
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
        },
    );
}