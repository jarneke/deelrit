import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/server-error";
import { calculateCarSettlement } from "@/lib/car-settlement";
import { getCarSettlementSnapshot } from "@/lib/car-settlement-snapshot";
import type { SettlementOverview } from "@/lib/car-settlement-view-types";

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
};

export class CarOverviewAccessError extends Error { }

function digest(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

export async function loadCarOverview(
    organizationId: string,
    userId: string,
) {
    let client: PoolClient | undefined;
    let transactionOpen = false;

    try {
        client = await db.connect();

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
            [organizationId, userId],
        );

        if (membership.rowCount !== 1) {
            throw new CarOverviewAccessError(
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

        const startpoint = startpointRow
            ? {
                tankDate: startpointRow.tank_date,
                odometer: startpointRow.odometer,
            }
            : null;

        const tripResult = await client.query<TripRow>(
            `
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
          trip.description
        FROM public.car_trip AS trip
        JOIN public."user" AS driver
          ON driver.id = trip.driver_id
        WHERE trip.organization_id = $1
        ORDER BY
          trip.start_odometer ASC,
          trip.end_odometer ASC,
          trip.id ASC
      `,
            [organizationId],
        );

        const trips = tripResult.rows.map((trip) => ({
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
        }));

        const refuelResult = await client.query<RefuelRow>(
            `
        SELECT
          refuel.id,
          refuel.paid_by,
          payer.name AS payer_name,
          refuel.created_by,
          refuel.updated_at::text AS version,
          refuel.tank_date::text AS tank_date,
          refuel.odometer,
          refuel.amount_cents,
          refuel.settled_at
        FROM public.car_refuel AS refuel
        JOIN public."user" AS payer
          ON payer.id = refuel.paid_by
        WHERE refuel.organization_id = $1
        ORDER BY refuel.odometer ASC
      `,
            [organizationId],
        );

        const refuels = refuelResult.rows.map((refuel) => ({
            id: refuel.id,
            paidBy: refuel.paid_by,
            payerName: refuel.payer_name,
            createdBy: refuel.created_by,
            version: refuel.version,
            tankDate: refuel.tank_date,
            odometer: refuel.odometer,
            amountCents: refuel.amount_cents,
            settledAt: refuel.settled_at?.toISOString() ?? null,
        }));

        const latestTrip = trips[trips.length - 1] ?? null;
        const latestRefuel = refuels[refuels.length - 1] ?? null;

        const totalDistance = trips.reduce(
            (total, trip) => total + trip.endOdometer - trip.startOdometer,
            0,
        );

        const gaps: { start: number; end: number }[] = [];
        let previousEnd = startpoint?.odometer ?? 0;

        for (const trip of trips) {
            if (trip.startOdometer > previousEnd) {
                gaps.push({
                    start: previousEnd,
                    end: trip.startOdometer,
                });
            }

            previousEnd = Math.max(previousEnd, trip.endOdometer);
        }

        const refuelHistoryRevision = digest(
            JSON.stringify({ startpoint, refuels }),
        );

        const tripHistoryRevision = digest(
            JSON.stringify({ trips, refuelHistoryRevision }),
        );

        const statementHistoryRevision = digest(
            JSON.stringify(
                refuels.map((refuel) => ({
                    id: refuel.id,
                    version: refuel.version,
                    settledAt: refuel.settledAt,
                })),
            ),
        );

        const settlement = startpoint
            ? calculateCarSettlement(startpoint, trips, refuels)
            : null;

        const statementSnapshot = settlement
            ? getCarSettlementSnapshot(settlement.periods)
            : null;

        let settlementOverview: SettlementOverview | null = null;

        if (settlement && statementSnapshot !== null) {
            const completePeriods = settlement.periods.filter(
                (period) => period.status === "complete",
            );

            settlementOverview = {
                transfers: settlement.transfers.map((transfer) => ({
                    fromUserId: transfer.fromUserId,
                    fromName: transfer.fromName,
                    toUserId: transfer.toUserId,
                    toName: transfer.toName,
                    amountCents: transfer.amountCents,
                    grossAmountCents: transfer.grossAmountCents,
                    offsetAmountCents: transfer.offsetAmountCents,
                })),
                completePeriodCount: settlement.completePeriodCount,
                incompletePeriodCount: settlement.incompletePeriodCount,
                openPeriodCount: settlement.periods.length,
                settledPeriodCount: settlement.settledPeriods.length,
                firstCompleteDate: completePeriods[0]?.startDate ?? null,
                lastCompleteDate:
                    completePeriods[completePeriods.length - 1]?.endDate ?? null,
                expectedSnapshot: digest(statementSnapshot),
                revision: tripHistoryRevision,
            };
        }

        await client.query("COMMIT");
        transactionOpen = false;

        return {
            startpoint,
            latestTrip,
            latestRefuel,
            tripCount: trips.length,
            refuelCount: refuels.length,
            totalDistance,
            gaps,
            refuelHistoryRevision,
            tripHistoryRevision,
            statementHistoryRevision,
            settlementOverview,

            // Alleen voor gebruik op de server.
            settlement,
            statementSnapshot,
        };
    } catch (error) {
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError("loadCarOverview.rollback", rollbackError);
            }
        }

        throw error;
    } finally {
        client?.release();
    }
}