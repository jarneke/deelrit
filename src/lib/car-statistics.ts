import {
    calculateCarSettlement,
    type SettlementRefuel,
    type SettlementTrip,
} from "@/lib/car-settlement";

export type StatisticsTrip = SettlementTrip & {
    id: string;
    tripDate: string;
};

export type StatisticsPerson = {
    userId: string;
    name: string;
    formerMember: boolean;
};

export type StatisticsDay = {
    date: string;
    userId: string;
    distance: number;
    trips: number;
    pricedKm: number;
    blockedKm: number;
    costCents: number;
    paidCents: number;
    shortTrips: number;
    mediumTrips: number;
    longTrips: number;
    shortKm: number;
    mediumKm: number;
    longKm: number;
};

export type StatisticsTank = {
    id: string;
    startDate: string;
    endDate: string;
    distance: number;
    amountCents: number;
    payerName: string;
    missingDistance: number;
    status: "complete" | "missing-trips" | "overlapping-trips";
};

export type StatisticsData = {
    today: string;
    startDate: string | null;
    people: StatisticsPerson[];
    days: StatisticsDay[];
    tanks: StatisticsTank[];
};

export type StatisticsSource = {
    today: string;
    startpoint: { tankDate: string; odometer: number } | null;
    members: { userId: string; name: string }[];
    trips: StatisticsTrip[];
    refuels: SettlementRefuel[];
};

export function shiftStatisticsDate(value: string, days: number): string {
    const date = new Date(value + "T12:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function calculateCarStatistics(
    source: StatisticsSource,
): StatisticsData {
    const people = new Map<string, StatisticsPerson>();

    for (const member of source.members) {
        people.set(member.userId, {
            ...member,
            formerMember: false,
        });
    }

    for (const trip of source.trips) {
        if (!people.has(trip.driverId)) {
            people.set(trip.driverId, {
                userId: trip.driverId,
                name: trip.driverName,
                formerMember: true,
            });
        }
    }

    for (const refuel of source.refuels) {
        if (!people.has(refuel.paidBy)) {
            people.set(refuel.paidBy, {
                userId: refuel.paidBy,
                name: refuel.payerName,
                formerMember: true,
            });
        }
    }

    const days = new Map<string, StatisticsDay>();

    function day(date: string, userId: string): StatisticsDay {
        const key = date + ":" + userId;
        let value = days.get(key);

        if (!value) {
            value = {
                date,
                userId,
                distance: 0,
                trips: 0,
                pricedKm: 0,
                blockedKm: 0,
                costCents: 0,
                paidCents: 0,
                shortTrips: 0,
                mediumTrips: 0,
                longTrips: 0,
                shortKm: 0,
                mediumKm: 0,
                longKm: 0,
            };
            days.set(key, value);
        }

        return value;
    }

    for (const trip of source.trips) {
        const row = day(trip.tripDate, trip.driverId);
        const distance = trip.endOdometer - trip.startOdometer;

        row.distance += distance;
        row.trips += 1;

        if (distance < 10) {
            row.shortTrips += 1;
            row.shortKm += distance;
        } else if (distance <= 50) {
            row.mediumTrips += 1;
            row.mediumKm += distance;
        } else {
            row.longTrips += 1;
            row.longKm += distance;
        }
    }

    for (const refuel of source.refuels) {
        day(refuel.tankDate, refuel.paidBy).paidCents += refuel.amountCents;
    }

    const settlement = source.startpoint
        ? calculateCarSettlement(
            source.startpoint,
            source.trips,
            source.refuels,
        )
        : null;

    const periods = settlement
        ? [...settlement.periods, ...settlement.settledPeriods]
            .sort((a, b) => a.endOdometer - b.endOdometer)
        : [];

    for (const period of periods) {
        const pieces = source.trips.flatMap((trip) => {
            const distance = Math.max(
                0,
                Math.min(trip.endOdometer, period.endOdometer) -
                Math.max(trip.startOdometer, period.startOdometer),
            );

            return distance > 0 ? [{ trip, distance }] : [];
        });

        if (period.status !== "complete") {
            for (const piece of pieces) {
                day(
                    piece.trip.tripDate,
                    piece.trip.driverId,
                ).blockedKm += piece.distance;
            }

            continue;
        }

        // Verdeel het bestaande aandeel van iedere bestuurder over diens
        // ritten. Zo blijven alle centen gelijk aan de afrekenberekening.
        for (const share of period.shares) {
            const ownPieces = pieces.filter(
                (piece) => piece.trip.driverId === share.userId,
            );

            if (
                ownPieces.reduce(
                    (sum, piece) => sum + piece.distance,
                    0,
                ) !== share.distance
            ) {
                throw new Error("De statistiekverdeling is inconsistent.");
            }

            const denominator = BigInt(share.distance);

            const allocations = ownPieces.map((piece) => {
                const numerator =
                    BigInt(share.amountCents) * BigInt(piece.distance);

                return {
                    ...piece,
                    cents: Number(numerator / denominator),
                    remainder: numerator % denominator,
                };
            });

            allocations.sort((a, b) => {
                if (a.remainder !== b.remainder) {
                    return a.remainder > b.remainder ? -1 : 1;
                }

                return a.trip.id < b.trip.id
                    ? -1
                    : a.trip.id > b.trip.id
                        ? 1
                        : 0;
            });

            const remaining = share.amountCents - allocations.reduce(
                (sum, allocation) => sum + allocation.cents,
                0,
            );

            for (let index = 0; index < remaining; index += 1) {
                allocations[index].cents += 1;
            }

            for (const allocation of allocations) {
                const row = day(
                    allocation.trip.tripDate,
                    share.userId,
                );

                row.pricedKm += allocation.distance;
                row.costCents += allocation.cents;
            }
        }
    }

    const earliest = shiftStatisticsDate(source.today, -729);

    return {
        today: source.today,
        startDate: source.startpoint?.tankDate ?? null,
        people: [...people.values()].sort((a, b) =>
            a.name.localeCompare(b.name, "nl-BE") ||
            a.userId.localeCompare(b.userId),
        ),
        days: [...days.values()]
            .filter(
                (row) =>
                    row.date >= earliest &&
                    row.date <= source.today,
            )
            .sort((a, b) =>
                a.date.localeCompare(b.date) ||
                a.userId.localeCompare(b.userId),
            ),
        tanks: periods
            .filter(
                (period) =>
                    period.endDate >= earliest &&
                    period.endDate <= source.today,
            )
            .map((period) => ({
                id: period.id,
                startDate: period.startDate,
                endDate: period.endDate,
                distance: period.distance,
                amountCents: period.amountCents,
                payerName: period.payerName,
                missingDistance: period.missingDistance,
                status: period.status,
            })),
    };
}