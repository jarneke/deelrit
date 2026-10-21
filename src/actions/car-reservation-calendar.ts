"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import type {
    ReservationWeekResult,
} from "@/lib/car-reservation-types";

type CalendarRow = {
    authorized: boolean;
    server_now: Date;
    items: {
        id: string;
        reserved_by: string;
        reserved_by_name: string;
        starts_at: string;
        ends_at: string;
        description: string;
        version: string;
    }[];
};

function validId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 128
    );
}

function parseMonday(value: unknown): Date | null {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value < "1900-01-01" ||
        value > "9998-12-31"
    ) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value ||
        date.getUTCDay() !== 1
    ) {
        return null;
    }

    return date;
}

export async function getCarReservationWeek(
    organizationId: string,
    weekStart: string,
): Promise<ReservationWeekResult> {
    const monday = parseMonday(weekStart);

    if (!validId(organizationId) || !monday) {
        return {
            success: false,
            error: "Ongeldige auto of kalenderweek.",
        };
    }

    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    const nextWeekStart = nextMonday.toISOString().slice(0, 10);

    try {
        const session = await getSession();

        if (!session) {
            return {
                success: false,
                error: "Log eerst in.",
            };
        }

        // Eén query: toegang en reserveringen gebruiken dezelfde snapshot.
        // Lokale middernachten worden afzonderlijk naar UTC omgerekend,
        // zodat ook weken met een zomer-/wintertijdwissel kloppen.
        const result = await db.query<CalendarRow>(
            `
                WITH access AS (
                    SELECT 1
                    FROM public.member
                    WHERE "organizationId" = $1
                      AND "userId" = $2
                ),
                bounds AS (
                    SELECT
                        $3::date::timestamp
                            AT TIME ZONE 'Europe/Brussels' AS starts_at,
                        $4::date::timestamp
                            AT TIME ZONE 'Europe/Brussels' AS ends_at
                ),
                reservations AS (
                    SELECT
                        reservation.id,
                        reservation.reserved_by,
                        person.name AS reserved_by_name,
                        reservation.starts_at,
                        reservation.ends_at,
                        reservation.description,
                        reservation.updated_at::text AS version
                    FROM public.car_reservation AS reservation
                    JOIN public."user" AS person
                      ON person.id = reservation.reserved_by
                    CROSS JOIN bounds
                    WHERE reservation.organization_id = $1
                      AND reservation.cancelled_at IS NULL
                      AND reservation.starts_at < bounds.ends_at
                      AND reservation.ends_at > bounds.starts_at
                      AND EXISTS (SELECT 1 FROM access)
                )
                SELECT
                    EXISTS (SELECT 1 FROM access) AS authorized,
                    clock_timestamp() AS server_now,
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                to_jsonb(reservations)
                                ORDER BY starts_at ASC, id ASC
                            )
                            FROM reservations
                        ),
                        '[]'::jsonb
                    ) AS items
            `,
            [
                organizationId,
                session.user.id,
                weekStart,
                nextWeekStart,
            ],
        );

        const row = result.rows[0];

        if (!row) {
            throw new Error("Het kalenderresultaat ontbreekt.");
        }

        if (!row.authorized) {
            return {
                success: false,
                error: "Je hebt geen toegang tot deze auto.",
            };
        }

        return {
            success: true,
            data: {
                weekStart,
                nextWeekStart,
                serverNow: row.server_now.toISOString(),
                items: row.items.map((reservation) => ({
                    id: reservation.id,
                    reservedBy: reservation.reserved_by,
                    reservedByName: reservation.reserved_by_name,
                    startsAt: new Date(
                        reservation.starts_at,
                    ).toISOString(),
                    endsAt: new Date(
                        reservation.ends_at,
                    ).toISOString(),
                    description: reservation.description,
                    version: reservation.version,
                })),
            },
        };
    } catch (error) {
        logServerError("getCarReservationWeek", error);

        return {
            success: false,
            error: "De agenda kon niet worden geladen. Probeer opnieuw.",
        };
    }
}