"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";

type RefuelInput = {
    organizationId: string;
    paidBy: string;
    tankDate: string;
    odometer: number;
    amount: string;
};

type UpdateRefuelInput = RefuelInput & {
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

type StartpointRow = {
    tank_date: string;
    odometer: number;
};

type RefuelRow = {
    id: string;
    paid_by: string;
    created_by: string;
    tank_date: string;
    odometer: number;
    amount_cents: number;
    settled_at: Date | null;
    version: string;
};

class RefuelValidationError extends Error {
    constructor(
        message: string,
        public readonly refreshRequired = false,
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

function validUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value,
        )
    );
}

function parseAmountCents(value: unknown): number | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim().replace(",", ".");

    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) {
        return null;
    }

    const [euros, decimals = ""] = normalized.split(".");

    const cents =
        Number(euros) * 100 +
        Number(decimals.padEnd(2, "0"));

    return (
        Number.isSafeInteger(cents) &&
        cents > 0 &&
        cents <= 2_147_483_647
    )
        ? cents
        : null;
}

function periodStarts(
    rows: RefuelRow[],
    startpoint: StartpointRow,
) {
    const result = new Map<string, string>();
    let previous = startpoint;

    const ordered = [...rows].sort(
        (a, b) => a.odometer - b.odometer,
    );

    for (const row of ordered) {
        result.set(
            row.id,
            `${previous.odometer}|${previous.tank_date}`,
        );

        previous = row;
    }

    return result;
}

async function saveRefuel(
    input: RefuelInput,
    edit?: {
        id: string;
        version: string;
    },
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
        !validId(input.organizationId) ||
        !validId(input.paidBy)
    ) {
        return {
            success: false,
            error: "Ongeldige auto of betaler.",
        };
    }

    if (
        !Number.isInteger(input.odometer) ||
        input.odometer < 0 ||
        input.odometer > 2_147_483_647
    ) {
        return {
            success: false,
            error: "Vul een geldige, gehele kilometerstand in.",
        };
    }

    const amountCents = parseAmountCents(input.amount);

    if (amountCents === null) {
        return {
            success: false,
            error:
                "Vul een bedrag groter dan nul in, met maximaal twee decimalen.",
        };
    }

    if (
        typeof input.tankDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tankDate)
    ) {
        return {
            success: false,
            error: "Vul een geldige tankdatum in.",
        };
    }

    const parsedDate = new Date(`${input.tankDate}T00:00:00Z`);

    const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Brussels",
    }).format(new Date());

    if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== input.tankDate ||
        input.tankDate < "1900-01-01" ||
        input.tankDate > today
    ) {
        return {
            success: false,
            error:
                "Vul een geldige tankdatum in die niet in de toekomst ligt.",
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
            throw new RefuelValidationError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const members = await client.query<{
            userId: string;
            role: string;
        }>(
            `
        SELECT "userId", role
        FROM public.member
        WHERE "organizationId" = $1
        FOR SHARE
      `,
            [input.organizationId],
        );

        const actor = members.rows.find(
            (member) => member.userId === session.user.id,
        );

        if (!actor) {
            throw new RefuelValidationError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const isOwner = actor.role
            .split(",")
            .map((role) => role.trim())
            .includes("owner");

        const result = await client.query<RefuelRow>(
            `
        SELECT
          id,
          paid_by,
          created_by,
          tank_date::text AS tank_date,
          odometer,
          amount_cents,
          settled_at,
          updated_at::text AS version
        FROM public.car_refuel
        WHERE organization_id = $1
        ORDER BY odometer ASC
        FOR UPDATE
      `,
            [input.organizationId],
        );

        const rows = result.rows;

        const original = edit
            ? rows.find((row) => row.id === edit.id)
            : undefined;

        if (edit) {
            if (!original) {
                throw new RefuelValidationError(
                    "Deze tankbeurt bestaat niet meer.",
                    true,
                );
            }

            if (
                !isOwner &&
                original.created_by !== session.user.id &&
                original.paid_by !== session.user.id
            ) {
                throw new RefuelValidationError(
                    "Je kunt alleen tankbeurten bewerken die je zelf invoerde of betaalde.",
                );
            }

            if (original.version !== edit.version) {
                throw new RefuelValidationError(
                    "Deze tankbeurt is ondertussen gewijzigd. Annuleer en open ze opnieuw om de nieuwste versie te bewerken.",
                    true,
                );
            }

            if (original.settled_at !== null) {
                throw new RefuelValidationError(
                    "Deze tankperiode is afgerekend. Een eigenaar moet ze eerst opnieuw openen.",
                    true,
                );
            }
        }

        const payerIsMember = members.rows.some(
            (member) => member.userId === input.paidBy,
        );

        if (
            !payerIsMember &&
            original?.paid_by !== input.paidBy
        ) {
            throw new RefuelValidationError(
                "De betaler is geen lid van deze autogroep.",
            );
        }

        const startpointResult = await client.query<StartpointRow>(
            `
        SELECT
          tank_date::text AS tank_date,
          odometer
        FROM public.car_startpoint
        WHERE organization_id = $1
        FOR SHARE
      `,
            [input.organizationId],
        );

        const startpoint = startpointResult.rows[0];

        if (!startpoint) {
            throw new RefuelValidationError(
                "Stel eerst het startpunt van deze auto in.",
            );
        }

        if (
            input.odometer <= startpoint.odometer ||
            input.tankDate < startpoint.tank_date
        ) {
            throw new RefuelValidationError(
                "De tankbeurt moet na het startpunt liggen, met een hogere kilometerstand.",
            );
        }

        const others = rows.filter(
            (row) => row.id !== edit?.id,
        );

        if (
            others.some(
                (row) => row.odometer === input.odometer,
            )
        ) {
            throw new RefuelValidationError(
                "Er bestaat al een andere tankbeurt op deze kilometerstand.",
            );
        }

        const proposed: RefuelRow[] = [
            ...others,
            {
                id: edit?.id ?? "new",
                paid_by: input.paidBy,
                created_by: original?.created_by ?? session.user.id,
                tank_date: input.tankDate,
                odometer: input.odometer,
                amount_cents: amountCents,
                settled_at: null,
                version: original?.version ?? "",
            },
        ];

        // Bewaak ook de startgrens van andere afgerekende periodes.
        const before = periodStarts(rows, startpoint);
        const after = periodStarts(proposed, startpoint);

        for (const row of rows) {
            if (
                row.settled_at &&
                before.get(row.id) !== after.get(row.id)
            ) {
                throw new RefuelValidationError(
                    `Deze wijziging verandert de afgerekende tankperiode die eindigt op ${row.tank_date}. Een eigenaar moet die periode eerst opnieuw openen.`,
                    true,
                );
            }
        }

        const refuelConflict = others.some(
            (row) =>
                (row.odometer < input.odometer &&
                    row.tank_date > input.tankDate) ||
                (row.odometer > input.odometer &&
                    row.tank_date < input.tankDate),
        );

        if (refuelConflict) {
            throw new RefuelValidationError(
                "De tankdatum past niet bij de kilometerstanden van de andere tankbeurten.",
            );
        }

        const tripConflict = await client.query(
            `
        SELECT id
        FROM public.car_trip
        WHERE organization_id = $1
          AND (
            (
              end_odometer <= $2
              AND trip_date > $3::date
            )
            OR
            (
              end_odometer > $2
              AND trip_date < $3::date
            )
          )
        LIMIT 1
      `,
            [
                input.organizationId,
                input.odometer,
                input.tankDate,
            ],
        );

        if (tripConflict.rowCount) {
            throw new RefuelValidationError(
                "De tankdatum en kilometerstand passen niet bij de geregistreerde ritten.",
            );
        }

        if (edit) {
            const updated = await client.query(
                `
          UPDATE public.car_refuel
          SET
            paid_by = $3,
            tank_date = $4::date,
            odometer = $5,
            amount_cents = $6,
            updated_at = clock_timestamp()
          WHERE organization_id = $1
            AND id = $2
            AND updated_at::text = $7
            AND settled_at IS NULL
        `,
                [
                    input.organizationId,
                    edit.id,
                    input.paidBy,
                    input.tankDate,
                    input.odometer,
                    amountCents,
                    edit.version,
                ],
            );

            if (updated.rowCount !== 1) {
                throw new RefuelValidationError(
                    "Deze tankbeurt is ondertussen gewijzigd. Open ze opnieuw.",
                    true,
                );
            }
        } else {
            await client.query(
                `
          INSERT INTO public.car_refuel (
            organization_id,
            paid_by,
            tank_date,
            odometer,
            amount_cents,
            created_by
          )
          VALUES ($1, $2, $3::date, $4, $5, $6)
        `,
                [
                    input.organizationId,
                    input.paidBy,
                    input.tankDate,
                    input.odometer,
                    amountCents,
                    session.user.id,
                ],
            );
        }

        await client.query("COMMIT");
        transactionOpen = false;
    } catch (error) {
        if (!(error instanceof RefuelValidationError)) {
            logServerError(
                edit ? "updateCarRefuel" : "createCarRefuel",
                error,
            );
        }

        if (client && transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                logServerError(
                    edit ? "updateCarRefuel.rollback" : "createCarRefuel.rollback",
                    rollbackError,
                );
            }
        }

        return {
            success: false,
            error:
                error instanceof RefuelValidationError
                    ? error.message
                    : "De tankbeurt kon niet worden opgeslagen. Probeer opnieuw.",
            refreshRequired:
                error instanceof RefuelValidationError &&
                error.refreshRequired,
        };
    } finally {
        client?.release();
    }

    revalidatePath(`/auto/${input.organizationId}`);

    return { success: true };
}

export async function createCarRefuel(
    input: RefuelInput,
): Promise<Result> {
    return saveRefuel(input);
}

export async function updateCarRefuel(
    input: UpdateRefuelInput,
): Promise<Result> {
    if (
        !input ||
        !validUuid(input.refuelId) ||
        !validId(input.expectedVersion)
    ) {
        return {
            success: false,
            error: "Ongeldige tankbeurt. Open ze opnieuw.",
        };
    }

    return saveRefuel(input, {
        id: input.refuelId,
        version: input.expectedVersion,
    });
}