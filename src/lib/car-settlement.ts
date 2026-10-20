export type SettlementTrip = {
    driverId: string;
    driverName: string;
    startOdometer: number;
    endOdometer: number;
};

export type SettlementRefuel = {
    id: string;
    paidBy: string;
    payerName: string;
    tankDate: string;
    odometer: number;
    amountCents: number;
    settledAt?: string | null;
};

type Startpoint = {
    tankDate: string;
    odometer: number;
};

type Gap = {
    start: number;
    end: number;
};

type DriverDistance = {
    userId: string;
    name: string;
    distance: number;
};

export type DriverShare = DriverDistance & {
    amountCents: number;
};

export type SettlementPeriod = {
    id: string;
    startDate: string;
    endDate: string;
    startOdometer: number;
    endOdometer: number;
    distance: number;
    amountCents: number;
    paidBy: string;
    payerName: string;
    settledAt: string | null;
    gaps: Gap[];
    missingDistance: number;
    status:
    | "complete"
    | "missing-trips"
    | "overlapping-trips";
    shares: DriverShare[];
};

export type SettlementBalance = {
    userId: string;
    name: string;
    paidCents: number;
    shareCents: number;
    balanceCents: number;
};

export type PaymentSource = {
    periodId: string;
    tankDate: string;
    startOdometer: number;
    endOdometer: number;
    distance: number;
    amountCents: number;
};

export type SettlementTransfer = {
    fromUserId: string;
    fromName: string;
    toUserId: string;
    toName: string;
    amountCents: number;
    grossAmountCents: number;
    offsetAmountCents: number;
    sources: PaymentSource[];
    offsetSources: PaymentSource[];
};

export type CarSettlement = {
    periods: SettlementPeriod[];
    settledPeriods: SettlementPeriod[];
    balances: SettlementBalance[];
    transfers: SettlementTransfer[];
    completePeriodCount: number;
    incompletePeriodCount: number;
};

function divideCost(
    amountCents: number,
    totalDistance: number,
    drivers: DriverDistance[],
): DriverShare[] {
    const denominator = BigInt(totalDistance);

    const allocations = drivers.map((driver) => {
        const numerator =
            BigInt(amountCents) * BigInt(driver.distance);

        return {
            ...driver,
            amountCents: Number(numerator / denominator),
            remainder: numerator % denominator,
        };
    });

    allocations.sort((a, b) => {
        if (a.remainder !== b.remainder) {
            return a.remainder > b.remainder ? -1 : 1;
        }

        if (a.userId === b.userId) {
            return 0;
        }

        return a.userId < b.userId ? -1 : 1;
    });

    const allocatedCents = allocations.reduce(
        (total, allocation) => total + allocation.amountCents,
        0,
    );

    const remainingCents = amountCents - allocatedCents;

    for (let index = 0; index < remainingCents; index += 1) {
        allocations[index].amountCents += 1;
    }

    return allocations.map((allocation) => ({
        userId: allocation.userId,
        name: allocation.name,
        distance: allocation.distance,
        amountCents: allocation.amountCents,
    }));
}

function sumSources(sources: PaymentSource[]): number {
    return sources.reduce(
        (total, source) => total + source.amountCents,
        0,
    );
}

export function calculateCarSettlement(
    startpoint: Startpoint,
    trips: SettlementTrip[],
    refuels: SettlementRefuel[],
): CarSettlement {
    const orderedTrips = [...trips].sort(
        (a, b) =>
            a.startOdometer - b.startOdometer ||
            a.endOdometer - b.endOdometer,
    );

    // Ook afgerekende tankbeurten blijven hier staan:
    // ze bepalen nog steeds waar elke tankperiode begint.
    const orderedRefuels = [...refuels].sort(
        (a, b) => a.odometer - b.odometer,
    );

    const periods: SettlementPeriod[] = [];
    const settledPeriods: SettlementPeriod[] = [];

    const balanceMap = new Map<
        string,
        SettlementBalance
    >();

    // Bestuurder -> betaler -> bijdragen per tankperiode.
    const paymentMap = new Map<
        string,
        Map<string, PaymentSource[]>
    >();

    function getBalance(
        userId: string,
        name: string,
    ): SettlementBalance {
        const existing = balanceMap.get(userId);

        if (existing) {
            return existing;
        }

        const balance: SettlementBalance = {
            userId,
            name,
            paidCents: 0,
            shareCents: 0,
            balanceCents: 0,
        };

        balanceMap.set(userId, balance);

        return balance;
    }

    function addPaymentSource(
        fromUserId: string,
        toUserId: string,
        source: PaymentSource,
    ) {
        let recipients = paymentMap.get(fromUserId);

        if (!recipients) {
            recipients = new Map<string, PaymentSource[]>();
            paymentMap.set(fromUserId, recipients);
        }

        const existing = recipients.get(toUserId);

        if (existing) {
            existing.push(source);
        } else {
            recipients.set(toUserId, [source]);
        }
    }

    function getPaymentSources(
        fromUserId: string,
        toUserId: string,
    ): PaymentSource[] {
        return (
            paymentMap.get(fromUserId)?.get(toUserId) ?? []
        );
    }

    let periodStart = startpoint.odometer;
    let periodStartDate = startpoint.tankDate;

    for (const refuel of orderedRefuels) {
        if (refuel.odometer <= periodStart) {
            throw new Error(
                "Tankbeurten moeten verschillende kilometerstanden boven het startpunt hebben.",
            );
        }

        const gaps: Gap[] = [];

        const driverDistances = new Map<
            string,
            DriverDistance
        >();

        let coveredUntil = periodStart;
        let hasOverlap = false;

        for (const trip of orderedTrips) {
            const start = Math.max(
                trip.startOdometer,
                periodStart,
            );

            const end = Math.min(
                trip.endOdometer,
                refuel.odometer,
            );

            if (start >= end) {
                continue;
            }

            if (start > coveredUntil) {
                gaps.push({
                    start: coveredUntil,
                    end: start,
                });
            }

            if (start < coveredUntil) {
                hasOverlap = true;
            }

            coveredUntil = Math.max(coveredUntil, end);

            const existing = driverDistances.get(
                trip.driverId,
            );

            if (existing) {
                existing.distance += end - start;
            } else {
                driverDistances.set(trip.driverId, {
                    userId: trip.driverId,
                    name: trip.driverName,
                    distance: end - start,
                });
            }
        }

        if (coveredUntil < refuel.odometer) {
            gaps.push({
                start: coveredUntil,
                end: refuel.odometer,
            });
        }

        const distance =
            refuel.odometer - periodStart;

        const missingDistance = gaps.reduce(
            (total, gap) => total + gap.end - gap.start,
            0,
        );

        const status: SettlementPeriod["status"] =
            hasOverlap
                ? "overlapping-trips"
                : missingDistance > 0
                    ? "missing-trips"
                    : "complete";

        const shares =
            status === "complete"
                ? divideCost(
                    refuel.amountCents,
                    distance,
                    [...driverDistances.values()],
                )
                : [];

        const period: SettlementPeriod = {
            id: refuel.id,
            startDate: periodStartDate,
            endDate: refuel.tankDate,
            startOdometer: periodStart,
            endOdometer: refuel.odometer,
            distance,
            amountCents: refuel.amountCents,
            paidBy: refuel.paidBy,
            payerName: refuel.payerName,
            settledAt: refuel.settledAt ?? null,
            gaps,
            missingDistance,
            status,
            shares,
        };

        if (period.settledAt) {
            settledPeriods.push(period);
        } else {
            periods.push(period);
        }

        // Alleen openstaande, volledige periodes tellen mee.
        if (
            period.settledAt === null &&
            period.status === "complete"
        ) {
            const payer = getBalance(
                period.paidBy,
                period.payerName,
            );

            payer.paidCents += period.amountCents;

            for (const share of period.shares) {
                const driver = getBalance(
                    share.userId,
                    share.name,
                );

                driver.shareCents += share.amountCents;

                // Iemands eigen aandeel vereist geen betaling
                // aan zichzelf.
                if (
                    share.userId === period.paidBy ||
                    share.amountCents === 0
                ) {
                    continue;
                }

                addPaymentSource(
                    share.userId,
                    period.paidBy,
                    {
                        periodId: period.id,
                        tankDate: period.endDate,
                        startOdometer: period.startOdometer,
                        endOdometer: period.endOdometer,
                        distance: share.distance,
                        amountCents: share.amountCents,
                    },
                );
            }
        }

        // Dit gebeurt ook voor afgerekende periodes.
        periodStart = refuel.odometer;
        periodStartDate = refuel.tankDate;
    }

    const transfers: SettlementTransfer[] = [];

    const participants = [...balanceMap.values()].sort(
        (a, b) => {
            if (a.userId === b.userId) {
                return 0;
            }

            return a.userId < b.userId ? -1 : 1;
        },
    );

    // Elk tweetal één keer bekijken.
    // Alleen wederzijdse schulden tussen die twee
    // personen worden tegen elkaar weggestreept.
    for (
        let firstIndex = 0;
        firstIndex < participants.length;
        firstIndex += 1
    ) {
        const first = participants[firstIndex];

        for (
            let secondIndex = firstIndex + 1;
            secondIndex < participants.length;
            secondIndex += 1
        ) {
            const second = participants[secondIndex];

            const forwardSources = getPaymentSources(
                first.userId,
                second.userId,
            );

            const backwardSources = getPaymentSources(
                second.userId,
                first.userId,
            );

            const forwardCents =
                sumSources(forwardSources);

            const backwardCents =
                sumSources(backwardSources);

            const netCents =
                forwardCents - backwardCents;

            if (netCents === 0) {
                continue;
            }

            const from =
                netCents > 0 ? first : second;

            const to =
                netCents > 0 ? second : first;

            transfers.push({
                fromUserId: from.userId,
                fromName: from.name,
                toUserId: to.userId,
                toName: to.name,
                amountCents: Math.abs(netCents),
                grossAmountCents:
                    netCents > 0
                        ? forwardCents
                        : backwardCents,
                offsetAmountCents:
                    netCents > 0
                        ? backwardCents
                        : forwardCents,
                sources:
                    netCents > 0
                        ? forwardSources
                        : backwardSources,
                offsetSources:
                    netCents > 0
                        ? backwardSources
                        : forwardSources,
            });
        }
    }

    transfers.sort(
        (a, b) =>
            a.fromName.localeCompare(
                b.fromName,
                "nl-BE",
            ) ||
            a.toName.localeCompare(
                b.toName,
                "nl-BE",
            ) ||
            a.fromUserId.localeCompare(
                b.fromUserId,
            ) ||
            a.toUserId.localeCompare(
                b.toUserId,
            ),
    );

    const balances = [...balanceMap.values()]
        .map((balance) => ({
            ...balance,
            balanceCents:
                balance.paidCents -
                balance.shareCents,
        }))
        .sort(
            (a, b) =>
                a.name.localeCompare(
                    b.name,
                    "nl-BE",
                ) ||
                a.userId.localeCompare(
                    b.userId,
                ),
        );

    const completePeriodCount = periods.filter(
        (period) => period.status === "complete",
    ).length;

    return {
        periods,
        settledPeriods,
        balances,
        transfers,
        completePeriodCount,
        incompletePeriodCount:
            periods.length - completePeriodCount,
    };
}