import {
    calculateCarSettlement,
    type SettlementRefuel,
    type SettlementTrip,
} from "@/lib/car-settlement";
import {
    allocateCostCents,
    getWeightedTripPayers,
} from "@/lib/car-trip-payers";

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
    tripCounts: {
        date: string;
        userIds: string[];
        distance: number;
    }[];
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
        for (const payer of getWeightedTripPayers(trip, 0)) {
            if (!people.has(payer.payerId)) {
                people.set(payer.payerId, {
                    userId: payer.payerId,
                    name: payer.isGuest
                        ? `${payer.name} (gast)`
                        : payer.name,
                    formerMember: !payer.isGuest,
                });
            }
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

    // Afstandsvelden worden intern in zestigsten van een kilometer
    // opgebouwd. Pas bij het teruggeven worden ze naar km omgezet.
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
        const distance = trip.endOdometer - trip.startOdometer;

        for (const payer of getWeightedTripPayers(trip, distance)) {
            const row = day(trip.tripDate, payer.payerId);

            row.distance += payer.distanceUnits;
            row.trips += 1;

            // De categorie volgt de volledige ritlengte.
            // Het kilometeraandeel volgt de verdeling van de rit.
            if (distance < 10) {
                row.shortTrips += 1;
                row.shortKm += payer.distanceUnits;
            } else if (distance <= 50) {
                row.mediumTrips += 1;
                row.mediumKm += payer.distanceUnits;
            } else {
                row.longTrips += 1;
                row.longKm += payer.distanceUnits;
            }
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

            return distance > 0
                ? getWeightedTripPayers(trip, distance).map((payer) => ({
                    trip,
                    payerId: payer.payerId,
                    distanceUnits: payer.distanceUnits,
                }))
                : [];
        });

        if (period.status !== "complete") {
            for (const piece of pieces) {
                day(
                    piece.trip.tripDate,
                    piece.payerId,
                ).blockedKm += piece.distanceUnits;
            }

            continue;
        }

        // Verdeel ieders bestaande afrekenaandeel over diens ritten.
        // De statistieken behouden zo exact dezelfde centen.
        for (const share of period.shares) {
            const ownPieces = pieces.filter(
                (piece) => piece.payerId === share.userId,
            );

            const totalUnits = ownPieces.reduce(
                (sum, piece) => sum + piece.distanceUnits,
                0,
            );

            if (
                totalUnits <= 0 ||
                totalUnits / 60 !== share.distance
            ) {
                throw new Error("De statistiekverdeling is inconsistent.");
            }

            const allocations = allocateCostCents(
                share.amountCents,
                ownPieces.map((piece) => ({
                    id: piece.trip.id,
                    weight: piece.distanceUnits,
                })),
            );

            const pieceMap = new Map(
                ownPieces.map((piece) => [piece.trip.id, piece]),
            );

            for (const allocation of allocations) {
                const piece = pieceMap.get(allocation.id);

                if (!piece) {
                    throw new Error("Een statistiekrit ontbreekt.");
                }

                const row = day(
                    piece.trip.tripDate,
                    share.userId,
                );

                row.pricedKm += piece.distanceUnits;
                row.costCents += allocation.amountCents;
            }
        }
    }

    const earliest = shiftStatisticsDate(source.today, -729);

    return {
        today: source.today,
        startDate: source.startpoint?.tankDate ?? null,
        people: [...people.values()].sort(
            (a, b) =>
                a.name.localeCompare(b.name, "nl-BE") ||
                a.userId.localeCompare(b.userId),
        ),
        days: [...days.values()]
            .map((row) => ({
                ...row,
                distance: row.distance / 60,
                pricedKm: row.pricedKm / 60,
                blockedKm: row.blockedKm / 60,
                shortKm: row.shortKm / 60,
                mediumKm: row.mediumKm / 60,
                longKm: row.longKm / 60,
            }))
            .filter(
                (row) =>
                    row.date >= earliest &&
                    row.date <= source.today,
            )
            .sort(
                (a, b) =>
                    a.date.localeCompare(b.date) ||
                    a.userId.localeCompare(b.userId),
            ),
        tripCounts: source.trips
            .filter(
                (trip) =>
                    trip.tripDate >= earliest &&
                    trip.tripDate <= source.today,
            )
            .map((trip) => ({
                date: trip.tripDate,
                userIds: getWeightedTripPayers(trip, 0).map(
                    (payer) => payer.payerId,
                ),
                distance: trip.endOdometer - trip.startOdometer,
            })),
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