"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type MemberAction = "promote" | "demote" | "remove";

type Result =
    | { success: true; removedSelf: boolean }
    | { success: false; error: string };

type MemberRow = {
    id: string;
    userId: string;
    role: string;
};

function validId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128
    );
}

function isOwner(role: string) {
    return role
        .split(",")
        .map((value) => value.trim())
        .includes("owner");
}

export async function manageGroupMember(
    organizationId: string,
    memberId: string,
    action: MemberAction
): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return {
            success: false,
            error: "Log eerst in.",
        };
    }

    if (
        !validId(organizationId) ||
        !validId(memberId) ||
        !["promote", "demote", "remove"].includes(action)
    ) {
        return {
            success: false,
            error: "Ongeldige aanvraag.",
        };
    }

    let client: PoolClient | undefined;
    let transactionOpen = false;
    let removedSelf = false;

    try {
        client = await db.connect();

        await client.query("BEGIN");
        transactionOpen = true;

        // Alle ledenwijzigingen voor dezelfde groep worden na elkaar verwerkt.
        const organization = await client.query(
            `
        SELECT id
        FROM public.organization
        WHERE id = $1
        FOR UPDATE
      `,
            [organizationId]
        );

        if (organization.rowCount !== 1) {
            await client.query("ROLLBACK");
            transactionOpen = false;

            return {
                success: false,
                error: "Je kunt deze groep niet beheren.",
            };
        }

        const result = await client.query<MemberRow>(
            `
        SELECT id, "userId", role
        FROM public.member
        WHERE "organizationId" = $1
        FOR UPDATE
      `,
            [organizationId]
        );

        const actor = result.rows.find(
            (member) => member.userId === session.user.id
        );

        if (!actor || !isOwner(actor.role)) {
            await client.query("ROLLBACK");
            transactionOpen = false;

            return {
                success: false,
                error: "Alleen eigenaars kunnen leden beheren.",
            };
        }

        const target = result.rows.find(
            (member) => member.id === memberId
        );

        if (!target) {
            await client.query("ROLLBACK");
            transactionOpen = false;

            return {
                success: false,
                error: "Dit lid zit niet meer in de groep.",
            };
        }

        const ownerCount = result.rows.filter(
            (member) => isOwner(member.role)
        ).length;

        const removesOwnership =
            action === "demote" || action === "remove";

        if (
            removesOwnership &&
            isOwner(target.role) &&
            ownerCount <= 1
        ) {
            await client.query("ROLLBACK");
            transactionOpen = false;

            return {
                success: false,
                error:
                    "Er moet minstens één eigenaar overblijven. Maak eerst iemand anders co-eigenaar.",
            };
        }

        if (action === "remove") {
            await client.query(
                `
          DELETE FROM public.member
          WHERE id = $1
            AND "organizationId" = $2
        `,
                [memberId, organizationId]
            );

            await client.query(
                `
          UPDATE public.session
          SET "activeOrganizationId" = NULL
          WHERE "userId" = $1
            AND "activeOrganizationId" = $2
        `,
                [target.userId, organizationId]
            );

            removedSelf = target.userId === session.user.id;
        } else {
            const role = action === "promote" ? "owner" : "member";

            await client.query(
                `
          UPDATE public.member
          SET role = $1
          WHERE id = $2
            AND "organizationId" = $3
        `,
                [role, memberId, organizationId]
            );
        }

        if (removesOwnership) {
            // Oude uitnodigingen mogen niet opnieuw werken na een latere promotie.
            await client.query(
                `
          UPDATE public.car_invitation_link
          SET revoked_at = NOW()
          WHERE organization_id = $1
            AND created_by = $2
            AND used_at IS NULL
            AND revoked_at IS NULL
        `,
                [organizationId, target.userId]
            );
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch {
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch {
                // De verbinding kan al verbroken zijn.
            }
        }

        return {
            success: false,
            error: "De wijziging kon niet worden opgeslagen. Probeer opnieuw.",
        };
    } finally {
        client?.release();
    }

    revalidatePath("/");
    revalidatePath(`/auto/${organizationId}`);

    return {
        success: true,
        removedSelf,
    };
}