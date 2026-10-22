export const MAX_TRIP_PAYERS = 5;
export const MAX_GUEST_NAME_LENGTH = 80;
export const DISTANCE_UNITS_PER_KM = 60;

export type TripPayerInput =
    | {
        kind: "member";
        userId: string;
    }
    | {
        kind: "guest";
        guestId?: string;
        name: string;
    };

export type TripPayer =
    | {
        kind: "member";
        userId: string;
        name: string;
    }
    | {
        kind: "guest";
        guestId: string;
        name: string;
    };

export type LegacyTripPayer = {
    driverId: string;
    driverName: string;
    payers?: TripPayer[];
};

export type WeightedTripPayer = {
    payerId: string;
    name: string;
    isGuest: boolean;
    distanceUnits: number;
};

export type CostWeight = {
    id: string;
    weight: number;
};

export type CostAllocation = CostWeight & {
    amountCents: number;
};

export type PayerValidationResult =
    | {
        success: true;
        payers: TripPayerInput[];
    }
    | {
        success: false;
        error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function validUserId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 128 &&
        value === value.trim()
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

export function normalizeGuestName(value: string): string {
    return value.trim().replace(/\s+/gu, " ");
}

export function validateTripPayerInputs(
    value: unknown,
): PayerValidationResult {
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > MAX_TRIP_PAYERS
    ) {
        return {
            success: false,
            error: "Kies minimaal één en maximaal vijf betalers.",
        };
    }

    const payers: TripPayerInput[] = [];
    const identities = new Set<string>();

    for (const item of value) {
        if (!isRecord(item)) {
            return {
                success: false,
                error: "Een van de betalers is ongeldig.",
            };
        }

        if (item.kind === "member") {
            if (!validUserId(item.userId)) {
                return {
                    success: false,
                    error: "Kies een geldig groepslid.",
                };
            }

            const identity = `member:${item.userId}`;

            if (identities.has(identity)) {
                return {
                    success: false,
                    error: "Hetzelfde groepslid kan maar één keer betalen.",
                };
            }

            identities.add(identity);

            payers.push({
                kind: "member",
                userId: item.userId,
            });

            continue;
        }

        if (item.kind === "guest") {
            if (typeof item.name !== "string") {
                return {
                    success: false,
                    error: "Vul voor iedere gast een naam in.",
                };
            }

            const name = normalizeGuestName(item.name);

            if (
                name.length === 0 ||
                name.length > MAX_GUEST_NAME_LENGTH
            ) {
                return {
                    success: false,
                    error: "Een gastnaam moet tussen 1 en 80 tekens bevatten.",
                };
            }

            if (item.guestId !== undefined) {
                if (!validUuid(item.guestId)) {
                    return {
                        success: false,
                        error: "Een van de gasten is ongeldig.",
                    };
                }

                const guestId = item.guestId.toLowerCase();
                const identity = `guest:${guestId}`;

                if (identities.has(identity)) {
                    return {
                        success: false,
                        error: "Dezelfde gast kan maar één keer betalen.",
                    };
                }

                identities.add(identity);

                payers.push({
                    kind: "guest",
                    guestId,
                    name,
                });
            } else {
                payers.push({
                    kind: "guest",
                    name,
                });
            }

            continue;
        }

        return {
            success: false,
            error: "Kies een groepslid of een gast.",
        };
    }

    return {
        success: true,
        payers,
    };
}

export function getTripPayerId(payer: TripPayer): string {
    return payer.kind === "member"
        ? payer.userId
        : `guest:${payer.guestId}`;
}

export function getTripPayers(trip: LegacyTripPayer): TripPayer[] {
    if (trip.payers === undefined || trip.payers.length === 0) {
        return [
            {
                kind: "member",
                userId: trip.driverId,
                name: trip.driverName,
            },
        ];
    }

    if (trip.payers.length > MAX_TRIP_PAYERS) {
        throw new Error("Een rit kan maximaal vijf betalers hebben.");
    }

    const identities = trip.payers.map(getTripPayerId);

    if (new Set(identities).size !== identities.length) {
        throw new Error("Een rit bevat dezelfde betaler meerdere keren.");
    }

    return trip.payers;
}

export function formatTripPayers(trip: LegacyTripPayer): string {
    return getTripPayers(trip)
        .map((payer) =>
            payer.kind === "guest"
                ? `${payer.name} (gast)`
                : payer.name,
        )
        .join(" + ");
}

export function getWeightedTripPayers(
    trip: LegacyTripPayer,
    distanceKm: number,
): WeightedTripPayer[] {
    if (
        !Number.isSafeInteger(distanceKm) ||
        distanceKm < 0 ||
        !Number.isSafeInteger(distanceKm * DISTANCE_UNITS_PER_KM)
    ) {
        throw new Error("De ritafstand is ongeldig.");
    }

    const payers = getTripPayers(trip);

    const distanceUnits =
        (distanceKm * DISTANCE_UNITS_PER_KM) / payers.length;

    return payers.map((payer) => ({
        payerId: getTripPayerId(payer),
        name: payer.name,
        isGuest: payer.kind === "guest",
        distanceUnits,
    }));
}

export function allocateCostCents(
    amountCents: number,
    weights: CostWeight[],
): CostAllocation[] {
    if (
        !Number.isSafeInteger(amountCents) ||
        amountCents < 0
    ) {
        throw new Error("Het te verdelen bedrag is ongeldig.");
    }

    if (
        weights.length === 0 ||
        weights.some(
            (item) =>
                !item.id ||
                !Number.isSafeInteger(item.weight) ||
                item.weight <= 0,
        )
    ) {
        throw new Error("De kostenverdeling bevat ongeldige gewichten.");
    }

    if (new Set(weights.map((item) => item.id)).size !== weights.length) {
        throw new Error("De kostenverdeling bevat dubbele sleutels.");
    }

    const denominator = weights.reduce(
        (sum, item) => sum + BigInt(item.weight),
        BigInt(0),
    );

    const allocations = weights.map((item, index) => {
        const numerator = BigInt(amountCents) * BigInt(item.weight);

        return {
            ...item,
            index,
            amountCents: Number(numerator / denominator),
            remainder: numerator % denominator,
        };
    });

    allocations.sort((a, b) => {
        if (a.remainder !== b.remainder) {
            return a.remainder > b.remainder ? -1 : 1;
        }

        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const allocatedCents = allocations.reduce(
        (sum, item) => sum + item.amountCents,
        0,
    );

    const remainingCents = amountCents - allocatedCents;

    for (let index = 0; index < remainingCents; index += 1) {
        allocations[index].amountCents += 1;
    }

    return allocations
        .sort((a, b) => a.index - b.index)
        .map((item) => ({
            id: item.id,
            weight: item.weight,
            amountCents: item.amountCents,
        }));
}