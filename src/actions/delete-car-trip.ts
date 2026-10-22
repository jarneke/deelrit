"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import { loadCarTripPayers } from "@/lib/car-trip-payers-server";

type DeleteTripInput = {
    organizationId: string;
    tripId: string;
    expectedVersion: string;
};

type Result =
    | { success: true }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };

class DeleteTripError extends Error {
    constructor(
        message: string,
        public readonly refreshRequired = false,
    ) {
        super(message);
    }
}

function validText(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 128
    );
}

export async function deleteCarTrip(
    input: DeleteTripInput,
): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return {
            success: false,
            error: "Log eerst in.",
        };
    }

    if (
        !input ||
        !validText(input.organizationId) ||
        !validText(input.expectedVersion) ||
        typeof input.tripId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.tripId,
        )
    ) {
        return {
            success: false,
            error: "Ongeldige rit. Vernieuw het overzicht.",
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
            [input.organizationId],
        );

        if (organization.rowCount !== 1) {
            throw new DeleteTripError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const members = await client.query<{
            role: string;
        }>(
            `
            SELECT role
            FROM public.member
            WHERE "organizationId" = $1
                AND "userId" = $2
            FOR SHARE
            `,
            [input.organizationId, session.user.id],
        );

        const member = members.rows[0];

        if (!member) {
            throw new DeleteTripError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const isOwner = member.role
            .split(",")
            .map((role) => role.trim())
            .includes("owner");

        const result = await client.query<{
            driver_id: string;
            created_by: string;
            start_odometer: number;
            end_odometer: number;
            version: string;
        }>(
            `
            SELECT
                driver_id,
                created_by,
                start_odometer,
                end_odometer,
                updated_at::text AS version
            FROM public.car_trip
            WHERE organization_id = $1
                AND id = $2
            FOR UPDATE
            `,
            [input.organizationId, input.tripId],
        );

        const trip = result.rows[0];

        if (!trip) {
            throw new DeleteTripError(
                "Deze rit bestaat niet meer. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        const payerMap = await loadCarTripPayers(
            client,
            input.organizationId,
            [input.tripId],
        );

        const explicitPayers = payerMap.get(input.tripId);

        const actorIsPayer = explicitPayers
            ? explicitPayers.some(
                (payer) =>
                    payer.kind === "member" &&
                    payer.userId === session.user.id,
            )
            : trip.driver_id === session.user.id;

        if (
            !isOwner &&
            trip.created_by !== session.user.id &&
            !actorIsPayer
        ) {
            throw new DeleteTripError(
                "Je kunt alleen ritten verwijderen die je zelf invoerde of waarvoor je mee betaalt.",
            );
        }

        if (trip.version !== input.expectedVersion) {
            throw new DeleteTripError(
                "Deze rit is ondertussen gewijzigd. Bekijk de nieuwste versie voordat je ze verwijdert.",
                true,
            );
        }

        const startpointResult = await client.query<{
            odometer: number;
        }>(
            `
            SELECT odometer
            FROM public.car_startpoint
            WHERE organization_id = $1
            FOR SHARE
            `,
            [input.organizationId],
        );

        const startpoint = startpointResult.rows[0];

        if (!startpoint) {
            throw new DeleteTripError(
                "Het startpunt van deze auto ontbreekt.",
            );
        }

        const refuels = await client.query<{
            odometer: number;
            settled_at: Date | null;
        }>(
            `
            SELECT odometer, settled_at
            FROM public.car_refuel
            WHERE organization_id = $1
            ORDER BY odometer ASC
            FOR SHARE
            `,
            [input.organizationId],
        );

        let previousOdometer = startpoint.odometer;

        for (const refuel of refuels.rows) {
            if (
                refuel.settled_at &&
                trip.start_odometer < refuel.odometer &&
                trip.end_odometer > previousOdometer
            ) {
                throw new DeleteTripError(
                    "Deze rit raakt een afgerekende tankperiode. Een eigenaar moet die periode eerst opnieuw openen.",
                    true,
                );
            }

            previousOdometer = refuel.odometer;
        }

        const deleted = await client.query(
            `
            DELETE FROM public.car_trip
            WHERE organization_id = $1
                AND id = $2
                AND updated_at::text = $3
            `,
            [
                input.organizationId,
                input.tripId,
                input.expectedVersion,
            ],
        );

        if (deleted.rowCount !== 1) {
            throw new DeleteTripError(
                "De rit kon niet worden verwijderd. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (!(error instanceof DeleteTripError)) {
            logServerError("deleteCarTrip", error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError("deleteCarTrip.rollback", rollbackError);
            }
        }

        return {
            success: false,
            error:
                error instanceof DeleteTripError
                    ? error.message
                    : "Verwijderen is niet gelukt. Probeer opnieuw.",
            refreshRequired:
                error instanceof DeleteTripError &&
                error.refreshRequired,
        };
    } finally {
        client?.release();
    }

    revalidatePath(`/auto/${input.organizationId}`);
    revalidatePath(`/auto/${input.organizationId}/statistieken`);

    return { success: true };
}