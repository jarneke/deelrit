"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type CreateResult =
    | { success: true; path: string }
    | { success: false; error: string };

type ActionResult =
    | { success: true }
    | { success: false; error: string };

type AcceptResult =
    | { success: true; organizationId: string }
    | { success: false; error: string };

function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

function validToken(token: unknown): token is string {
    return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function validId(id: unknown): id is string {
    return typeof id === "string" && id.length > 0 && id.length <= 128;
}

export async function createInvitationLink(
    organizationId: string
): Promise<CreateResult> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (!validId(organizationId)) {
        return { success: false, error: "Ongeldige auto." };
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);

    try {
        const result = await db.query(
            `
        INSERT INTO public.car_invitation_link (
          organization_id,
          created_by,
          token_hash
        )
        SELECT $1, $2, $3
        WHERE EXISTS (
          SELECT 1
          FROM public.member
          WHERE "organizationId" = $1
            AND "userId" = $2
            AND 'owner' = ANY(string_to_array(role, ','))
        )
        RETURNING id
      `,
            [organizationId, session.user.id, tokenHash]
        );

        if (result.rowCount !== 1) {
            return {
                success: false,
                error: "Alleen een eigenaar kan een uitnodigingslink maken.",
            };
        }

        revalidatePath(`/auto/${organizationId}`);

        return {
            success: true,
            path: `/uitnodiging/${token}`,
        };
    } catch {
        return {
            success: false,
            error: "De uitnodigingslink kon niet worden gemaakt.",
        };
    }
}

export async function revokeInvitationLink(
    invitationId: string
): Promise<ActionResult> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (
        typeof invitationId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            invitationId
        )
    ) {
        return { success: false, error: "Ongeldige uitnodiging." };
    }

    try {
        const result = await db.query<{ organization_id: string }>(
            `
        UPDATE public.car_invitation_link AS invitation
        SET revoked_at = NOW()
        WHERE invitation.id = $1
          AND invitation.used_at IS NULL
          AND invitation.revoked_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.member
            WHERE "organizationId" = invitation.organization_id
              AND "userId" = $2
              AND 'owner' = ANY(string_to_array(role, ','))
          )
        RETURNING invitation.organization_id
      `,
            [invitationId, session.user.id]
        );

        if (result.rowCount !== 1) {
            return {
                success: false,
                error: "Je kunt deze uitnodiging niet intrekken.",
            };
        }

        revalidatePath(`/auto/${result.rows[0].organization_id}`);

        return { success: true };
    } catch {
        return {
            success: false,
            error: "De uitnodiging kon niet worden ingetrokken.",
        };
    }
}

export async function acceptInvitationLink(
    token: string
): Promise<AcceptResult> {
    const session = await getSession();

    if (!session) {
        return {
            success: false,
            error: "Log eerst in om deel te nemen.",
        };
    }

    if (!validToken(token)) {
        return {
            success: false,
            error: "Deze uitnodigingslink is ongeldig.",
        };
    }

    const tokenHash = hashToken(token);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        // Vergrendel eerst de groep. Dit voorkomt ook dubbele
        // lidmaatschappen via verschillende gelijktijdige links.
        const groupResult = await client.query<{ id: string }>(
            `
        SELECT organization.id
        FROM public.organization AS organization
        JOIN public.car_invitation_link AS invitation
          ON invitation.organization_id = organization.id
        WHERE invitation.token_hash = $1
        FOR UPDATE OF organization
      `,
            [tokenHash]
        );

        if (groupResult.rowCount !== 1) {
            await client.query("ROLLBACK");

            return {
                success: false,
                error: "Deze uitnodiging bestaat niet meer.",
            };
        }

        const organizationId = groupResult.rows[0].id;

        // Controle en gebruik gebeuren in dezelfde transactie.
        const invitationResult = await client.query<{ id: string }>(
            `
        SELECT invitation.id
        FROM public.car_invitation_link AS invitation
        WHERE invitation.token_hash = $1
          AND invitation.used_at IS NULL
          AND invitation.revoked_at IS NULL
          AND invitation.expires_at > clock_timestamp()
          AND EXISTS (
            SELECT 1
            FROM public.member
            WHERE "organizationId" = invitation.organization_id
              AND "userId" = invitation.created_by
              AND 'owner' = ANY(string_to_array(role, ','))
          )
        FOR UPDATE OF invitation
      `,
            [tokenHash]
        );

        if (invitationResult.rowCount !== 1) {
            await client.query("ROLLBACK");

            return {
                success: false,
                error: "Deze uitnodiging is verlopen, ingetrokken of al gebruikt.",
            };
        }

        const membership = await client.query(
            `
        SELECT id
        FROM public.member
        WHERE "organizationId" = $1
          AND "userId" = $2
      `,
            [organizationId, session.user.id]
        );

        if (membership.rowCount) {
            await client.query("ROLLBACK");

            // Een bestaand lid verbruikt de uitnodiging niet.
            return { success: true, organizationId };
        }

        const countResult = await client.query<{ total: number }>(
            `
        SELECT COUNT(*)::integer AS total
        FROM public.member
        WHERE "organizationId" = $1
      `,
            [organizationId]
        );

        if (countResult.rows[0].total >= 100) {
            await client.query("ROLLBACK");

            return {
                success: false,
                error: "Deze groep heeft het maximumaantal leden bereikt.",
            };
        }

        await client.query(
            `
        INSERT INTO public.member (
          id,
          "organizationId",
          "userId",
          role,
          "createdAt"
        )
        VALUES ($1, $2, $3, 'member', NOW())
      `,
            [randomUUID(), organizationId, session.user.id]
        );

        await client.query(
            `
        UPDATE public.car_invitation_link
        SET used_at = NOW(), used_by = $2
        WHERE id = $1
      `,
            [invitationResult.rows[0].id, session.user.id]
        );

        await client.query("COMMIT");

        revalidatePath("/");
        revalidatePath(`/auto/${organizationId}`);

        return { success: true, organizationId };
    } catch {
        await client.query("ROLLBACK");

        return {
            success: false,
            error: "Deelnemen is niet gelukt. Probeer opnieuw.",
        };
    } finally {
        client.release();
    }
}