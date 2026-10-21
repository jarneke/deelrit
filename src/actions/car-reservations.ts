"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";

type ReservationInput = {
    organizationId: string;
    startsAt: string;
    endsAt: string;
    description: string;
};

type UpdateInput = ReservationInput & {
    reservationId: string;
    expectedVersion: string;
};

type CancelInput = {
    organizationId: string;
    reservationId: string;
    expectedVersion: string;
};

type Result =
    | { success: true }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };

type ReservationRow = {
    reserved_by: string;
    version: string;
    cancelled_at: Date | null;
    starts_at: Date;
    ends_at: Date;
};

type Mutation =
    | { kind: "create"; input: ReservationInput }
    | { kind: "update"; input: UpdateInput }
    | { kind: "cancel"; input: CancelInput };

class ReservationError extends Error {
    constructor(
        message: string,
        readonly refreshRequired = false,
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

function validReservationId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
}

function validVersion(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 100
    );
}

// De interface levert UTC-tijdstippen via Date.toISOString().
// De agenda toont die tijdstippen later in Belgische tijd.
function parseInstant(value: unknown): Date | null {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ) {
        return null;
    }

    const date = new Date(value);

    if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString() !== value
    ) {
        return null;
    }

    return date;
}

function isOverlapError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const databaseError = error as {
        code?: unknown;
        constraint?: unknown;
    };

    return (
        databaseError.code === "23P01" &&
        databaseError.constraint === "car_reservation_no_overlap"
    );
}

async function mutateReservation(mutation: Mutation): Promise<Result> {
    const { input, kind } = mutation;

    if (!input || !validId(input.organizationId)) {
        return {
            success: false,
            error: "Ongeldige auto.",
        };
    }

    if (
        kind !== "create" &&
        (
            !validReservationId(mutation.input.reservationId) ||
            !validVersion(mutation.input.expectedVersion)
        )
    ) {
        return {
            success: false,
            error: "Ongeldige reservering. Vernieuw het overzicht.",
            refreshRequired: true,
        };
    }

    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    let description = "";

    if (mutation.kind !== "cancel") {
        startsAt = parseInstant(mutation.input.startsAt);
        endsAt = parseInstant(mutation.input.endsAt);

        if (
            !startsAt ||
            !endsAt ||
            endsAt.getTime() <= startsAt.getTime()
        ) {
            return {
                success: false,
                error: "Kies geldige tijdstippen met het einde na het begin.",
            };
        }

        if (
            typeof mutation.input.description !== "string" ||
            mutation.input.description.length > 500
        ) {
            return {
                success: false,
                error: "Gebruik maximaal 500 tekens voor de opmerking.",
            };
        }

        description = mutation.input.description.trim();
    }

    const actionName =
        kind === "create"
            ? "createCarReservation"
            : kind === "update"
                ? "updateCarReservation"
                : "cancelCarReservation";

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

        await client.query("BEGIN");
        transactionOpen = true;

        // Gebruik dezelfde vergrendelvolgorde als bij ledenbeheer.
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
            throw new ReservationError(
                "Deze auto is niet meer beschikbaar.",
                true,
            );
        }

        const membership = await client.query<{ role: string }>(
            `
                SELECT role
                FROM public.member
                WHERE "organizationId" = $1
                  AND "userId" = $2
                FOR UPDATE
            `,
            [input.organizationId, session.user.id],
        );

        if (membership.rowCount !== 1) {
            throw new ReservationError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const isOwner = membership.rows[0].role
            .split(",")
            .map((role) => role.trim())
            .includes("owner");

        let existing: ReservationRow | undefined;

        if (mutation.kind !== "create") {
            const result = await client.query<ReservationRow>(
                `
                    SELECT
                        reserved_by,
                        updated_at::text AS version,
                        cancelled_at,
                        starts_at,
                        ends_at
                    FROM public.car_reservation
                    WHERE id = $1
                      AND organization_id = $2
                    FOR UPDATE
                `,
                [
                    mutation.input.reservationId,
                    input.organizationId,
                ],
            );

            existing = result.rows[0];

            if (!existing) {
                throw new ReservationError(
                    "Deze reservering bestaat niet meer.",
                    true,
                );
            }

            if (
                existing.reserved_by !== session.user.id &&
                !isOwner
            ) {
                throw new ReservationError(
                    "Je kunt alleen je eigen reserveringen beheren.",
                );
            }

            if (
                existing.cancelled_at !== null ||
                existing.version !== mutation.input.expectedVersion
            ) {
                throw new ReservationError(
                    "Deze reservering is ondertussen gewijzigd. Vernieuw het overzicht.",
                    true,
                );
            }
        }

        const clockResult = await client.query<{ current_time: Date }>(
            "SELECT clock_timestamp() AS current_time",
        );
        const now = clockResult.rows[0].current_time.getTime();

        if (mutation.kind === "cancel") {
            if (!existing || existing.ends_at.getTime() <= now) {
                throw new ReservationError(
                    "Een afgelopen reservering kun je niet meer annuleren.",
                    true,
                );
            }

            const result = await client.query(
                `
                    UPDATE public.car_reservation
                    SET cancelled_at = clock_timestamp(),
                        cancelled_by = $1,
                        updated_at = clock_timestamp()
                    WHERE id = $2
                      AND organization_id = $3
                      AND updated_at::text = $4
                      AND cancelled_at IS NULL
                `,
                [
                    session.user.id,
                    mutation.input.reservationId,
                    input.organizationId,
                    mutation.input.expectedVersion,
                ],
            );

            if (result.rowCount !== 1) {
                throw new ReservationError(
                    "De reservering is ondertussen gewijzigd.",
                    true,
                );
            }
        } else {
            if (
                !startsAt ||
                !endsAt ||
                startsAt.getTime() <= now
            ) {
                throw new ReservationError(
                    "Kies een begintijd in de toekomst.",
                );
            }

            if (
                existing &&
                existing.starts_at.getTime() <= now
            ) {
                throw new ReservationError(
                    "Een begonnen reservering kun je niet meer wijzigen. Je kunt haar wel annuleren zolang ze nog loopt.",
                    true,
                );
            }

            if (mutation.kind === "create") {
                await client.query(
                    `
                        INSERT INTO public.car_reservation (
                            organization_id,
                            reserved_by,
                            starts_at,
                            ends_at,
                            description
                        )
                        VALUES ($1, $2, $3, $4, $5)
                    `,
                    [
                        input.organizationId,
                        session.user.id,
                        startsAt,
                        endsAt,
                        description,
                    ],
                );
            } else {
                const result = await client.query(
                    `
                        UPDATE public.car_reservation
                        SET starts_at = $1,
                            ends_at = $2,
                            description = $3,
                            updated_at = clock_timestamp()
                        WHERE id = $4
                          AND organization_id = $5
                          AND updated_at::text = $6
                          AND cancelled_at IS NULL
                    `,
                    [
                        startsAt,
                        endsAt,
                        description,
                        mutation.input.reservationId,
                        input.organizationId,
                        mutation.input.expectedVersion,
                    ],
                );

                if (result.rowCount !== 1) {
                    throw new ReservationError(
                        "De reservering is ondertussen gewijzigd.",
                        true,
                    );
                }
            }
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        const overlap = isOverlapError(error);

        if (!(error instanceof ReservationError) && !overlap) {
            logServerError(actionName, error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(`${actionName}.rollback`, rollbackError);
            }
        }

        if (overlap) {
            return {
                success: false,
                error: "De auto is tijdens deze periode al gereserveerd. Kies een ander tijdstip.",
                refreshRequired: true,
            };
        }

        return {
            success: false,
            error:
                error instanceof ReservationError
                    ? error.message
                    : "De reservering kon niet worden opgeslagen. Probeer opnieuw.",
            refreshRequired:
                error instanceof ReservationError
                    ? error.refreshRequired
                    : false,
        };
    } finally {
        client?.release();
    }

    revalidatePath(`/auto/${input.organizationId}`);

    return { success: true };
}

export async function createCarReservation(
    input: ReservationInput,
): Promise<Result> {
    return mutateReservation({ kind: "create", input });
}

export async function updateCarReservation(
    input: UpdateInput,
): Promise<Result> {
    return mutateReservation({ kind: "update", input });
}

export async function cancelCarReservation(
    input: CancelInput,
): Promise<Result> {
    return mutateReservation({ kind: "cancel", input });
}