"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import {
    GitHubImageError,
    removeCarPhoto,
    uploadCarPhoto,
} from "@/lib/github-images";

type Result =
    | {
        success: true;
        warning?: string;
    }
    | {
        success: false;
        error: string;
    };

type PhotoMode = "keep" | "replace" | "remove";

class CarSettingsError extends Error { }

export async function updateCarSettings(
    organizationId: string,
    name: string,
    licensePlate: string,
    photoData?: FormData,
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

    let photoMode: PhotoMode = "keep";
    let replacement: File | null = null;
    let expectedPhoto = "";

    if (photoData !== undefined) {
        if (!(photoData instanceof FormData)) {
            return {
                success: false,
                error: "Ongeldige fotogegevens.",
            };
        }

        const mode = photoData.get("mode");

        if (mode !== "keep" && mode !== "replace" && mode !== "remove") {
            return {
                success: false,
                error: "Ongeldige fotowijziging.",
            };
        }

        photoMode = mode;

        if (photoMode !== "keep") {
            const expected = photoData.get("expectedPhoto");

            if (typeof expected !== "string" || expected.length > 2048) {
                return {
                    success: false,
                    error: "De oorspronkelijke fotogegevens ontbreken.",
                };
            }

            expectedPhoto = expected;
        }

        if (photoMode === "replace") {
            const file = photoData.get("file");

            if (!(file instanceof File)) {
                return {
                    success: false,
                    error: "Kies eerst een autofoto.",
                };
            }

            replacement = file;
        }
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;
    let commitAttempted = false;
    let uploadedPhoto: string | null = null;
    let previousPhoto: string | null = null;

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

        const organization = await client.query<{
            id: string;
            logo: string | null;
        }>(
            `
        SELECT id, logo
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

        previousPhoto = organization.rows[0].logo;

        if (
            photoMode !== "keep" &&
            expectedPhoto !== (previousPhoto ?? "")
        ) {
            throw new CarSettingsError(
                "De autofoto is intussen gewijzigd. Sluit dit venster en laad de pagina opnieuw.",
            );
        }

        let nextPhoto = previousPhoto;

        if (photoMode === "replace" && replacement) {
            uploadedPhoto = await uploadCarPhoto(
                organizationId,
                replacement,
            );

            nextPhoto = uploadedPhoto;
        } else if (photoMode === "remove") {
            nextPhoto = null;
        }

        const updated = await client.query(
            `
        UPDATE public.organization
        SET name = $1,
            "licensePlate" = $2,
            logo = $3
        WHERE id = $4
      `,
            [cleanName, cleanPlate || null, nextPhoto, organizationId],
        );

        if (updated.rowCount !== 1) {
            throw new Error(
                "De autogegevens konden niet worden bijgewerkt.",
            );
        }

        commitAttempted = true;
        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (
            !(error instanceof CarSettingsError) &&
            !(error instanceof GitHubImageError)
        ) {
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

        if (uploadedPhoto && !commitAttempted) {
            try {
                await removeCarPhoto(organizationId, uploadedPhoto);
            } catch (cleanupError) {
                logServerError(
                    "updateCarSettings.uploadCleanup",
                    cleanupError,
                );
            }
        }

        return {
            success: false,
            error: commitAttempted
                ? "We konden niet bevestigen of de wijziging is opgeslagen. Laad de pagina opnieuw voordat je nogmaals opslaat."
                : error instanceof CarSettingsError ||
                    error instanceof GitHubImageError
                    ? error.message
                    : "De autogegevens konden niet worden opgeslagen. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }

    let warning: string | undefined;

    if (
        photoMode !== "keep" &&
        previousPhoto &&
        previousPhoto !== uploadedPhoto
    ) {
        try {
            await removeCarPhoto(organizationId, previousPhoto);
        } catch (cleanupError) {
            logServerError(
                "updateCarSettings.previousPhotoCleanup",
                cleanupError,
            );

            warning =
                "De wijziging is opgeslagen, maar het oude afbeeldingsbestand kon niet van GitHub worden verwijderd.";
        }
    }

    revalidatePath("/");
    revalidatePath(`/auto/${organizationId}`);

    return {
        success: true,
        ...(warning ? { warning } : {}),
    };
}