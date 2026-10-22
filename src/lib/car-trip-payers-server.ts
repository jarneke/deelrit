import "server-only";

import type { PoolClient } from "pg";
import {
    validateTripPayerInputs,
    type TripPayer,
} from "@/lib/car-trip-payers";

type Member = {
    userId: string;
    name: string;
};

type PayerRow = {
    trip_id: string;
    user_id: string | null;
    guest_id: string | null;
    member_name: string | null;
    guest_name: string | null;
};

export class CarTripPayerError extends Error { }

// Interne helper. De aanroeper controleert eerst de toegang tot de auto.
// Gebruik dezelfde client en transactie als de overige ritgegevens.
export async function loadCarTripPayers(
    client: PoolClient,
    organizationId: string,
    tripIds: string[],
): Promise<Map<string, TripPayer[]>> {
    const result = new Map<string, TripPayer[]>();

    if (tripIds.length === 0) {
        return result;
    }

    const rows = await client.query<PayerRow>(
        `
        SELECT
            payer.trip_id,
            payer.user_id,
            payer.guest_id,
            person.name AS member_name,
            guest.name AS guest_name
        FROM public.car_trip_payer AS payer
        LEFT JOIN public."user" AS person
            ON person.id = payer.user_id
        LEFT JOIN public.car_guest AS guest
            ON guest.id = payer.guest_id
            AND guest.organization_id = payer.organization_id
        WHERE payer.organization_id = $1
            AND payer.trip_id = ANY($2::uuid[])
        ORDER BY payer.trip_id, payer.position
        `,
        [organizationId, tripIds],
    );

    for (const row of rows.rows) {
        let payer: TripPayer;

        if (row.user_id !== null && row.member_name !== null) {
            payer = {
                kind: "member",
                userId: row.user_id,
                name: row.member_name,
            };
        } else if (row.guest_id !== null && row.guest_name !== null) {
            payer = {
                kind: "guest",
                guestId: row.guest_id,
                name: row.guest_name,
            };
        } else {
            throw new Error("Een opgeslagen ritbetaler is ongeldig.");
        }

        const existing = result.get(row.trip_id);

        if (existing) {
            existing.push(payer);
        } else {
            result.set(row.trip_id, [payer]);
        }
    }

    return result;
}

// Aanroepen nadat toegang, ritversie en periodeblokkeringen zijn gecontroleerd.
// De aanroeper houdt de organisatie vergrendeld en beheert de transactie.
export async function resolveCarTripPayers(
    client: PoolClient,
    organizationId: string,
    actorId: string,
    input: unknown,
    members: Member[],
    previousPayers: TripPayer[],
): Promise<TripPayer[]> {
    const validation = validateTripPayerInputs(input);

    if (!validation.success) {
        throw new CarTripPayerError(validation.error);
    }

    const resolved: TripPayer[] = [];

    for (const payer of validation.payers) {
        if (payer.kind === "member") {
            const member = members.find(
                (item) => item.userId === payer.userId,
            );

            const previous = previousPayers.find(
                (item) =>
                    item.kind === "member" &&
                    item.userId === payer.userId,
            );

            if (!member && !previous) {
                throw new CarTripPayerError(
                    "Een gekozen betaler is geen lid van deze autogroep.",
                );
            }

            resolved.push({
                kind: "member",
                userId: payer.userId,
                name: member?.name ?? previous!.name,
            });

            continue;
        }

        if (payer.guestId) {
            const existing = await client.query<{
                id: string;
                name: string;
            }>(
                `
                SELECT id, name
                FROM public.car_guest
                WHERE organization_id = $1
                    AND id = $2
                FOR SHARE
                `,
                [organizationId, payer.guestId],
            );

            const guest = existing.rows[0];

            if (!guest) {
                throw new CarTripPayerError(
                    "Een gekozen gast hoort niet bij deze auto.",
                );
            }

            if (guest.name === payer.name) {
                resolved.push({
                    kind: "guest",
                    guestId: guest.id,
                    name: guest.name,
                });

                continue;
            }

            // Een andere naam krijgt een eigen identiteit.
            // Eerdere ritten en afrekeningen blijven hierdoor ongewijzigd.
        }

        const created = await client.query<{
            id: string;
            name: string;
        }>(
            `
            INSERT INTO public.car_guest (
                organization_id,
                name,
                created_by
            )
            VALUES ($1, $2, $3)
            RETURNING id, name
            `,
            [organizationId, payer.name, actorId],
        );

        const guest = created.rows[0];

        if (!guest) {
            throw new Error("De gast kon niet worden aangemaakt.");
        }

        resolved.push({
            kind: "guest",
            guestId: guest.id,
            name: guest.name,
        });
    }

    return resolved;
}

// Interne schrijfhelper. Alleen gebruiken met de opgeloste betalers hierboven,
// binnen dezelfde transactie als het toevoegen of bijwerken van de rit.
export async function replaceCarTripPayers(
    client: PoolClient,
    organizationId: string,
    tripId: string,
    payers: TripPayer[],
): Promise<void> {
    const validation = validateTripPayerInputs(payers);

    if (
        !validation.success ||
        payers.some(
            (payer) =>
                payer.kind === "guest" && !payer.guestId,
        )
    ) {
        throw new CarTripPayerError(
            "De betalers van deze rit zijn ongeldig.",
        );
    }

    await client.query(
        `
        DELETE FROM public.car_trip_payer
        WHERE organization_id = $1
            AND trip_id = $2
        `,
        [organizationId, tripId],
    );

    for (let index = 0; index < payers.length; index += 1) {
        const payer = payers[index];

        await client.query(
            `
            INSERT INTO public.car_trip_payer (
                trip_id,
                organization_id,
                position,
                user_id,
                guest_id
            )
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
                tripId,
                organizationId,
                index + 1,
                payer.kind === "member" ? payer.userId : null,
                payer.kind === "guest" ? payer.guestId : null,
            ],
        );
    }
}