"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type Result =
    | { success: true }
    | { success: false; error: string };

export async function saveCarStartpoint(
    organizationId: string,
    tankDate: string,
    odometer: number
): Promise<Result> {
    const session = await getSession();

    if (!session) {
        return { success: false, error: "Log eerst in." };
    }

    if (
        typeof organizationId !== "string" ||
        !organizationId ||
        organizationId.length > 128
    ) {
        return { success: false, error: "Ongeldige auto." };
    }

    if (
        typeof tankDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tankDate)
    ) {
        return { success: false, error: "Vul een geldige datum in." };
    }

    const parsedDate = new Date(`${tankDate}T00:00:00Z`);

    if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== tankDate
    ) {
        return { success: false, error: "Vul een geldige datum in." };
    }

    const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Brussels",
    }).format(new Date());

    if (tankDate < "1900-01-01" || tankDate > today) {
        return {
            success: false,
            error: "De tankdatum mag niet in de toekomst liggen.",
        };
    }

    if (
        !Number.isInteger(odometer) ||
        odometer < 0 ||
        odometer > 2_147_483_647
    ) {
        return {
            success: false,
            error: "Vul een geldige, gehele kilometerstand in.",
        };
    }

    try {
        const result = await db.query(
            `
        INSERT INTO public.car_startpoint (
          organization_id,
          tank_date,
          odometer,
          created_by
        )
        SELECT $1, $2::date, $3, $4
        WHERE EXISTS (
          SELECT 1
          FROM public.member
          WHERE "organizationId" = $1
            AND "userId" = $4
            AND 'owner' = ANY(string_to_array(role, ','))
        )
        ON CONFLICT (organization_id) DO NOTHING
        RETURNING organization_id
      `,
            [organizationId, tankDate, odometer, session.user.id]
        );

        if (result.rowCount !== 1) {
            return {
                success: false,
                error:
                    "Het startpunt bestaat al of je bent geen eigenaar van deze auto.",
            };
        }
    } catch {
        return {
            success: false,
            error: "Het startpunt kon niet worden opgeslagen.",
        };
    }

    revalidatePath(`/auto/${organizationId}`);

    return { success: true };
}