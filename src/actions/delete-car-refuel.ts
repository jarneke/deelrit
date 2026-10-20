"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type Input = {
    organizationId: string;
    refuelId: string;
    expectedVersion: string;
};

type Result =
    | { success: true }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };

type RefuelRow = {
    id: string;
    paid_by: string;
    created_by: string;
    settled_at: Date | null;
    version: string;
};

class DeleteRefuelError extends Error {
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

export async function deleteCarRefuel(input: Input): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (
        !input ||
        !validText(input.organizationId) ||
        !validText(input.expectedVersion) ||
        typeof input.refuelId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.refuelId,
        )
    ) {
        return {
            success: false,
            error: "Ongeldige tankbeurt. Vernieuw het overzicht.",
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
            throw new DeleteRefuelError("Je hebt geen toegang tot deze auto.");
        }

        const members = await client.query<{ role: string }>(
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
            throw new DeleteRefuelError("Je hebt geen toegang tot deze auto.");
        }

        const isOwner = member.role
            .split(",")
            .map((role) => role.trim())
            .includes("owner");

        const result = await client.query<RefuelRow>(
            `
        SELECT
          id,
          paid_by,
          created_by,
          settled_at,
          updated_at::text AS version
        FROM public.car_refuel
        WHERE organization_id = $1
        ORDER BY odometer ASC
        FOR UPDATE
      `,
            [input.organizationId],
        );

        const index = result.rows.findIndex(
            (refuel) => refuel.id === input.refuelId,
        );

        const refuel = result.rows[index];

        if (!refuel) {
            throw new DeleteRefuelError(
                "Deze tankbeurt bestaat niet meer. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        if (
            !isOwner &&
            refuel.created_by !== session.user.id &&
            refuel.paid_by !== session.user.id
        ) {
            throw new DeleteRefuelError(
                "Je kunt alleen tankbeurten verwijderen die je zelf invoerde of betaalde.",
            );
        }

        if (refuel.version !== input.expectedVersion) {
            throw new DeleteRefuelError(
                "Deze tankbeurt is ondertussen gewijzigd. Bekijk de nieuwste versie voordat je ze verwijdert.",
                true,
            );
        }

        if (refuel.settled_at !== null) {
            throw new DeleteRefuelError(
                "Deze tankperiode is afgerekend. Een eigenaar moet ze eerst opnieuw openen.",
                true,
            );
        }

        // Deze tankbeurt bepaalt ook de startgrens van de volgende periode.
        const nextRefuel = result.rows[index + 1];

        if (nextRefuel && nextRefuel.settled_at !== null) {
            throw new DeleteRefuelError(
                "Deze tankbeurt vormt de startgrens van een afgerekende periode. Een eigenaar moet die volgende periode eerst opnieuw openen.",
                true,
            );
        }

        const deleted = await client.query(
            `
        DELETE FROM public.car_refuel
        WHERE organization_id = $1
          AND id = $2
          AND updated_at::text = $3
          AND settled_at IS NULL
      `,
            [input.organizationId, input.refuelId, input.expectedVersion],
        );

        if (deleted.rowCount !== 1) {
            throw new DeleteRefuelError(
                "De tankbeurt kon niet worden verwijderd. Het overzicht wordt vernieuwd.",
                true,
            );
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch {
                // De verbinding kan al verbroken zijn.
            }
        }

        return {
            success: false,
            error:
                error instanceof DeleteRefuelError
                    ? error.message
                    : "Verwijderen is niet gelukt. Probeer opnieuw.",
            refreshRequired:
                error instanceof DeleteRefuelError && error.refreshRequired,
        };
    } finally {
        client?.release();
    }

    revalidatePath(`/auto/${input.organizationId}`);

    return { success: true };
}