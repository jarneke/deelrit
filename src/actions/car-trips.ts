"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

type TripInput = {
    organizationId: string;
    driverId: string;
    tripDate: string;
    endTime: string;
    startOdometer: number;
    endOdometer: number;
    description: string;
};

type UpdateTripInput = TripInput & {
    tripId: string;
    expectedVersion: string;
};

type Result =
    | { success: true }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };

type ExistingTrip = {
    id: string;
    driver_id: string;
    created_by: string;
    start_odometer: number;
    end_odometer: number;
    ended_at: Date | null;
    local_time: string | null;
    version: string;
};

class TripValidationError extends Error {
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

function validOdometer(
    value: unknown,
): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 2_147_483_647
    );
}

async function saveTrip(
    input: TripInput,
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
        !validId(input.driverId)
    ) {
        return {
            success: false,
            error: "Ongeldige auto of bestuurder.",
        };
    }

    if (
        !validOdometer(input.startOdometer) ||
        !validOdometer(input.endOdometer) ||
        input.endOdometer <= input.startOdometer
    ) {
        return {
            success: false,
            error:
                "De eindstand moet hoger zijn dan de beginstand.",
        };
    }

    if (
        typeof input.tripDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.tripDate)
    ) {
        return {
            success: false,
            error: "Vul een geldige datum in.",
        };
    }

    const parsedDate = new Date(
        `${input.tripDate}T00:00:00Z`,
    );

    const today = new Intl.DateTimeFormat(
        "sv-SE",
        {
            timeZone: "Europe/Brussels",
        },
    ).format(new Date());

    if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !==
        input.tripDate ||
        input.tripDate < "1900-01-01" ||
        input.tripDate > today
    ) {
        return {
            success: false,
            error:
                "Vul een geldige datum in die niet in de toekomst ligt.",
        };
    }

    if (
        typeof input.endTime !== "string" ||
        (input.endTime !== "" &&
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(
                input.endTime,
            ))
    ) {
        return {
            success: false,
            error: "Vul een geldige eindtijd in.",
        };
    }

    if (
        typeof input.description !== "string" ||
        input.description.length > 500
    ) {
        return {
            success: false,
            error:
                "De opmerking mag maximaal 500 tekens bevatten.",
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
            throw new TripValidationError(
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
            (member) =>
                member.userId === session.user.id,
        );

        if (!actor) {
            throw new TripValidationError(
                "Je hebt geen toegang tot deze auto.",
            );
        }

        const isOwner = actor.role
            .split(",")
            .map((role) => role.trim())
            .includes("owner");

        let original: ExistingTrip | undefined;

        if (edit) {
            const result =
                await client.query<ExistingTrip>(
                    `
            SELECT
              id,
              driver_id,
              created_by,
              start_odometer,
              end_odometer,
              ended_at,
              to_char(
                ended_at AT TIME ZONE 'Europe/Brussels',
                'YYYY-MM-DD HH24:MI'
              ) AS local_time,
              updated_at::text AS version
            FROM public.car_trip
            WHERE organization_id = $1
              AND id = $2
            FOR UPDATE
          `,
                    [input.organizationId, edit.id],
                );

            original = result.rows[0];

            if (!original) {
                throw new TripValidationError(
                    "Deze rit bestaat niet meer.",
                    true,
                );
            }

            if (
                !isOwner &&
                original.created_by !== session.user.id &&
                original.driver_id !== session.user.id
            ) {
                throw new TripValidationError(
                    "Je kunt alleen ritten bewerken die je zelf invoerde of reed.",
                );
            }

            if (original.version !== edit.version) {
                throw new TripValidationError(
                    "Deze rit is ondertussen gewijzigd. Annuleer en open de rit opnieuw om de nieuwste versie te bewerken.",
                    true,
                );
            }
        }

        const driverIsMember = members.rows.some(
            (member) =>
                member.userId === input.driverId,
        );

        if (
            !driverIsMember &&
            original?.driver_id !== input.driverId
        ) {
            throw new TripValidationError(
                "De bestuurder is geen lid van deze autogroep.",
            );
        }

        const startpointResult =
            await client.query<{
                tank_date: string;
                odometer: number;
            }>(
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

        const startpoint =
            startpointResult.rows[0];

        if (!startpoint) {
            throw new TripValidationError(
                "Stel eerst het startpunt van deze auto in.",
            );
        }

        if (
            input.startOdometer < startpoint.odometer ||
            input.tripDate < startpoint.tank_date
        ) {
            throw new TripValidationError(
                "De rit mag niet vóór het startpunt liggen.",
            );
        }

        const refuels = await client.query<{
            odometer: number;
            tank_date: string;
            settled_at: Date | null;
        }>(
            `
        SELECT
          odometer,
          tank_date::text AS tank_date,
          settled_at
        FROM public.car_refuel
        WHERE organization_id = $1
        ORDER BY odometer ASC
        FOR SHARE
      `,
            [input.organizationId],
        );

        let previousOdometer =
            startpoint.odometer;

        for (const refuel of refuels.rows) {
            const newTouches =
                input.startOdometer < refuel.odometer &&
                input.endOdometer > previousOdometer;

            const oldTouches =
                original &&
                original.start_odometer < refuel.odometer &&
                original.end_odometer > previousOdometer;

            if (
                refuel.settled_at &&
                (newTouches || oldTouches)
            ) {
                throw new TripValidationError(
                    "Deze rit raakt een afgerekende tankperiode. Een eigenaar moet de betrokken periode eerst opnieuw openen.",
                );
            }

            previousOdometer = refuel.odometer;
        }

        for (const refuel of refuels.rows) {
            if (
                (input.endOdometer <= refuel.odometer &&
                    input.tripDate > refuel.tank_date) ||
                (input.endOdometer > refuel.odometer &&
                    input.tripDate < refuel.tank_date)
            ) {
                throw new TripValidationError(
                    "De ritdatum en kilometerstanden passen niet bij de tankbeurten.",
                );
            }
        }

        let endedAt: Date | null = null;

        if (input.endTime === "") {
            if (
                !original ||
                original.ended_at !== null
            ) {
                throw new TripValidationError(
                    "Vul een geldige eindtijd in.",
                );
            }
        } else {
            const localDateTime =
                `${input.tripDate} ${input.endTime}`;

            // Behoud het bestaande tijdstip als datum en
            // lokale tijd ongewijzigd zijn, ook bij wintertijd.
            const preserved =
                original?.local_time === localDateTime
                    ? original.ended_at
                    : null;

            const timeResult = await client.query<{
                ended_at: Date;
                local_time: string;
                not_future: boolean;
            }>(
                `
          SELECT
            stamp AS ended_at,
            to_char(
              stamp AT TIME ZONE 'Europe/Brussels',
              'YYYY-MM-DD HH24:MI'
            ) AS local_time,
            stamp <= clock_timestamp() AS not_future
          FROM (
            SELECT
              CASE
                WHEN $2::timestamptz IS NOT NULL
                  THEN $2::timestamptz
                ELSE
                  $1::timestamp
                    AT TIME ZONE 'Europe/Brussels'
              END AS stamp
          ) AS converted
        `,
                [localDateTime, preserved ?? null],
            );

            const time = timeResult.rows[0];

            if (
                !time ||
                time.local_time !== localDateTime
            ) {
                throw new TripValidationError(
                    "Deze lokale tijd bestaat niet door de omschakeling naar zomertijd.",
                );
            }

            if (!time.not_future) {
                throw new TripValidationError(
                    "De eindtijd mag niet in de toekomst liggen.",
                );
            }

            endedAt = time.ended_at;
        }

        const overlap = await client.query(
            `
        SELECT id
        FROM public.car_trip
        WHERE organization_id = $1
          AND start_odometer < $3
          AND end_odometer > $2
          AND (
            $4::uuid IS NULL
            OR id <> $4::uuid
          )
        LIMIT 1
      `,
            [
                input.organizationId,
                input.startOdometer,
                input.endOdometer,
                edit?.id ?? null,
            ],
        );

        if (overlap.rowCount) {
            throw new TripValidationError(
                "Deze kilometerstanden overlappen met een andere rit.",
            );
        }

        const timeConflict = await client.query(
            `
        SELECT id
        FROM public.car_trip
        WHERE organization_id = $1
          AND (
            $6::uuid IS NULL
            OR id <> $6::uuid
          )
          AND (
            (
              end_odometer <= $2
              AND CASE
                WHEN ended_at IS NOT NULL
                  AND $5::timestamptz IS NOT NULL
                  THEN ended_at > $5::timestamptz
                ELSE trip_date > $4::date
              END
            )
            OR
            (
              start_odometer >= $3
              AND CASE
                WHEN ended_at IS NOT NULL
                  AND $5::timestamptz IS NOT NULL
                  THEN ended_at < $5::timestamptz
                ELSE trip_date < $4::date
              END
            )
          )
        LIMIT 1
      `,
            [
                input.organizationId,
                input.startOdometer,
                input.endOdometer,
                input.tripDate,
                endedAt,
                edit?.id ?? null,
            ],
        );

        if (timeConflict.rowCount) {
            throw new TripValidationError(
                "Het tijdstip past niet bij de volgorde van de kilometerstanden.",
            );
        }

        if (edit) {
            const updated = await client.query(
                `
          UPDATE public.car_trip
          SET
            driver_id = $3,
            trip_date = $4::date,
            ended_at = $5,
            start_odometer = $6,
            end_odometer = $7,
            description = $8,
            updated_at = clock_timestamp()
          WHERE organization_id = $1
            AND id = $2
            AND updated_at::text = $9
        `,
                [
                    input.organizationId,
                    edit.id,
                    input.driverId,
                    input.tripDate,
                    endedAt,
                    input.startOdometer,
                    input.endOdometer,
                    input.description.trim(),
                    edit.version,
                ],
            );

            if (updated.rowCount !== 1) {
                throw new TripValidationError(
                    "Deze rit is ondertussen gewijzigd. Open de rit opnieuw.",
                    true,
                );
            }
        } else {
            await client.query(
                `
          INSERT INTO public.car_trip (
            organization_id,
            driver_id,
            trip_date,
            ended_at,
            start_odometer,
            end_odometer,
            description,
            created_by
          )
          VALUES (
            $1, $2, $3::date, $4,
            $5, $6, $7, $8
          )
        `,
                [
                    input.organizationId,
                    input.driverId,
                    input.tripDate,
                    endedAt,
                    input.startOdometer,
                    input.endOdometer,
                    input.description.trim(),
                    session.user.id,
                ],
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
                error instanceof TripValidationError
                    ? error.message
                    : "De rit kon niet worden opgeslagen. Probeer opnieuw.",
            refreshRequired:
                error instanceof TripValidationError &&
                error.refreshRequired,
        };
    } finally {
        client?.release();
    }

    revalidatePath(
        `/auto/${input.organizationId}`,
    );

    return { success: true };
}

export async function createCarTrip(
    input: TripInput,
): Promise<Result> {
    return saveTrip(input);
}

export async function updateCarTrip(
    input: UpdateTripInput,
): Promise<Result> {
    if (
        !input ||
        !validUuid(input.tripId) ||
        !validId(input.expectedVersion)
    ) {
        return {
            success: false,
            error:
                "Ongeldige rit. Open de rit opnieuw.",
        };
    }

    return saveTrip(input, {
        id: input.tripId,
        version: input.expectedVersion,
    });
}