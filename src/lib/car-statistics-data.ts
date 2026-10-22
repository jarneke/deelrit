import "server-only";

import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/server-error";
import { loadCarTripPayers } from "@/lib/car-trip-payers-server";
import {
    calculateCarStatistics,
    type StatisticsTrip,
} from "@/lib/car-statistics";

export class StatisticsAccessError extends Error { }

export async function loadCarStatistics(
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

        const carResult = await client.query<{
            name: string;
            license_plate: string | null;
        }>(
            `
            SELECT
                organization.name,
                organization."licensePlate" AS license_plate
            FROM public.organization AS organization
            WHERE organization.id = $1
                AND EXISTS (
                    SELECT 1
                    FROM public.member
                    WHERE "organizationId" = organization.id
                        AND "userId" = $2
                )
            `,
            [organizationId, userId],
        );

        const car = carResult.rows[0];

        if (!car) {
            throw new StatisticsAccessError(
                "Geen toegang tot deze auto.",
            );
        }

        const startResult = await client.query<{
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

        const members = await client.query<{
            userId: string;
            name: string;
        }>(
            `
            SELECT member."userId", person.name
            FROM public.member AS member
            JOIN public."user" AS person
                ON person.id = member."userId"
            WHERE member."organizationId" = $1
            `,
            [organizationId],
        );

        const tripResult = await client.query<{
            id: string;
            driver_id: string;
            driver_name: string;
            trip_date: string;
            start_odometer: number;
            end_odometer: number;
        }>(
            `
            SELECT
                trip.id,
                trip.driver_id,
                person.name AS driver_name,
                trip.trip_date::text AS trip_date,
                trip.start_odometer,
                trip.end_odometer
            FROM public.car_trip AS trip
            JOIN public."user" AS person
                ON person.id = trip.driver_id
            WHERE trip.organization_id = $1
            ORDER BY
                trip.start_odometer,
                trip.end_odometer,
                trip.id
            `,
            [organizationId],
        );

        const payerMap = await loadCarTripPayers(
            client,
            organizationId,
            tripResult.rows.map((trip) => trip.id),
        );

        const refuelResult = await client.query<{
            id: string;
            paid_by: string;
            payer_name: string;
            tank_date: string;
            odometer: number;
            amount_cents: number;
            settled_at: Date | null;
        }>(
            `
            SELECT
                refuel.id,
                refuel.paid_by,
                person.name AS payer_name,
                refuel.tank_date::text AS tank_date,
                refuel.odometer,
                refuel.amount_cents,
                refuel.settled_at
            FROM public.car_refuel AS refuel
            JOIN public."user" AS person
                ON person.id = refuel.paid_by
            WHERE refuel.organization_id = $1
            ORDER BY refuel.odometer, refuel.id
            `,
            [organizationId],
        );

        const trips: StatisticsTrip[] = tripResult.rows.map((trip) => ({
            id: trip.id,
            driverId: trip.driver_id,
            driverName: trip.driver_name,
            payers: payerMap.get(trip.id),
            tripDate: trip.trip_date,
            startOdometer: trip.start_odometer,
            endOdometer: trip.end_odometer,
        }));

        const start = startResult.rows[0];

        const today = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Brussels",
        }).format(new Date());

        const statistics = calculateCarStatistics({
            today,
            startpoint: start
                ? {
                    tankDate: start.tank_date,
                    odometer: start.odometer,
                }
                : null,
            members: members.rows,
            trips,
            refuels: refuelResult.rows.map((refuel) => ({
                id: refuel.id,
                paidBy: refuel.paid_by,
                payerName: refuel.payer_name,
                tankDate: refuel.tank_date,
                odometer: refuel.odometer,
                amountCents: refuel.amount_cents,
                settledAt: refuel.settled_at?.toISOString() ?? null,
            })),
        });

        await client.query("COMMIT");
        transactionOpen = false;

        return {
            carName: car.name,
            licensePlate: car.license_plate,
            statistics,
        };
    } catch (error) {
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(
                    "loadCarStatistics.rollback",
                    rollbackError,
                );
            }
        }

        throw error;
    } finally {
        client?.release();
    }
}