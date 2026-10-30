"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import {
    GitHubImageError,
    removeProfilePhoto,
    uploadProfilePhoto,
} from "@/lib/github-images";

type Result =
    | { success: true; photoUrl: string | null; warning?: string }
    | { success: false; error: string; reloadRequired?: boolean };

class ProfilePhotoError extends Error { }

export async function updateProfilePhoto(data: FormData): Promise<Result> {
    if (!(data instanceof FormData)) {
        return { success: false, error: "Ongeldige fotogegevens." };
    }

    const mode = data.get("mode");
    const expectedPhoto = data.get("expectedPhoto");

    if (
        (mode !== "replace" && mode !== "remove") ||
        typeof expectedPhoto !== "string" ||
        expectedPhoto.length > 2048
    ) {
        return { success: false, error: "Ongeldige fotowijziging." };
    }

    const file = data.get("file");

    if (
        mode === "replace" &&
        (!(file instanceof File) ||
            file.type !== "image/jpeg" ||
            file.size === 0 ||
            file.size > 700 * 1024)
    ) {
        return {
            success: false,
            error: "Kies een verwerkte JPEG-foto van maximaal 700 KB.",
        };
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;
    let commitAttempted = false;
    let uploadedPhoto: string | null = null;
    let previousPhoto: string | null = null;
    let nextPhoto: string | null = null;
    let userId = "";

    try {
        const session = await getSession();

        if (!session) {
            return { success: false, error: "Log eerst in." };
        }

        userId = session.user.id;
        client = await db.connect();

        await client.query("BEGIN");
        transactionOpen = true;

        const result = await client.query<{ image: string | null }>(
            `
        SELECT image
        FROM public."user"
        WHERE id = $1
        FOR UPDATE
      `,
            [userId],
        );

        if (result.rowCount !== 1) {
            throw new ProfilePhotoError("Je profiel is niet meer beschikbaar.");
        }

        previousPhoto = result.rows[0].image;

        if (expectedPhoto !== (previousPhoto ?? "")) {
            throw new ProfilePhotoError(
                "Je profielfoto is intussen gewijzigd. Sluit het venster en laad de pagina opnieuw.",
            );
        }

        if (mode === "replace" && file instanceof File) {
            uploadedPhoto = await uploadProfilePhoto(userId, file);
            nextPhoto = uploadedPhoto;
        }

        const updated = await client.query(
            `
        UPDATE public."user"
        SET image = $1, "updatedAt" = NOW()
        WHERE id = $2
      `,
            [nextPhoto, userId],
        );

        if (updated.rowCount !== 1) {
            throw new Error("De profielfoto kon niet worden bijgewerkt.");
        }

        commitAttempted = true;
        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (
            !(error instanceof ProfilePhotoError) &&
            !(error instanceof GitHubImageError)
        ) {
            logServerError("updateProfilePhoto", error);
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError("updateProfilePhoto.rollback", rollbackError);
            }
        }

        if (uploadedPhoto && !commitAttempted) {
            try {
                await removeProfilePhoto(userId, uploadedPhoto);
            } catch (cleanupError) {
                logServerError("updateProfilePhoto.uploadCleanup", cleanupError);
            }
        }

        return {
            success: false,
            error: commitAttempted
                ? "We konden niet bevestigen of je foto is opgeslagen. Laad de pagina opnieuw voordat je nogmaals opslaat."
                : error instanceof ProfilePhotoError ||
                    error instanceof GitHubImageError
                    ? error.message
                    : "Je profielfoto kon niet worden opgeslagen. Probeer opnieuw.",
            reloadRequired: commitAttempted || error instanceof ProfilePhotoError,
        };
    } finally {
        client?.release();
    }

    let warning: string | undefined;

    if (previousPhoto && previousPhoto !== nextPhoto) {
        try {
            await removeProfilePhoto(userId, previousPhoto);
        } catch (cleanupError) {
            logServerError("updateProfilePhoto.previousPhotoCleanup", cleanupError);
            warning =
                "Je wijziging is opgeslagen, maar de oude foto kon niet van GitHub worden verwijderd.";
        }
    }

    revalidatePath("/", "layout");

    return {
        success: true,
        photoUrl: nextPhoto,
        ...(warning ? { warning } : {}),
    };
}