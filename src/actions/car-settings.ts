"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";

type Result =
    | { success: true }
    | { success: false; error: string };

class CarSettingsError extends Error { }

export async function updateCarSettings(
    organizationId: string,
    name: string,
    licensePlate: string,
): Promise<Result> {
    if (
        typeof organizationId !== "string" ||
        organizationId.trim().length === 0 ||
        organizationId.length > 128 ||
        typeof name !== "string" ||
        typeof licensePlate !== "string"
    ) {
        return {
            success: false,
            error: "Ongeldige autogegevens.",
        };
    }

    const cleanName = name.trim();
    const cleanPlate = licensePlate.trim().toUpperCase();

    if (cleanName.length === 0 || cleanName.length > 80) {
        return {
            success: false,
            error: "Geef een autonaam van maximaal 80 tekens.",
        };
    }

    if (cleanPlate.length > 20) {
        return {
            success: false,
            error: "Gebruik maximaal 20 tekens voor de nummerplaat.",
        };
    }

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

        // Dezelfde vergrendelvolgorde als bij het beheren van groepsleden.
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
            throw new CarSettingsError(
                "Deze auto is niet meer beschikbaar.",
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
            [organizationId, session.user.id],
        );

        const role = membership.rows[0]?.role;
        const isOwner =
            membership.rowCount === 1 &&
            typeof role === "string" &&
            role
                .split(",")
                .map((value) => value.trim())
                .includes("owner");

        if (!isOwner) {
            throw new CarSettingsError(
                "Alleen eigenaars kunnen de autogegevens wijzigen.",
            );
        }

        const updated = await client.query(
            `
                UPDATE public.organization
                SET name = $1,
                    "licensePlate" = $2
                WHERE id = $3
            `,
            [cleanName, cleanPlate || null, organizationId],
        );

        if (updated.rowCount !== 1) {
            throw new Error(
                "De autogegevens konden niet worden bijgewerkt.",
            );
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (!(error instanceof CarSettingsError)) {
            logServerError("updateCarSettings", error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(
                    "updateCarSettings.rollback",
                    rollbackError,
                );
            }
        }

        return {
            success: false,
            error:
                error instanceof CarSettingsError
                    ? error.message
                    : "De autogegevens konden niet worden opgeslagen. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }

    revalidatePath("/");
    revalidatePath(`/auto/${organizationId}`);

    return { success: true };
}