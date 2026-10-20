import type { SettlementPeriod } from "@/lib/car-settlement";

function compareIds(a: string, b: string) {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function getCarSettlementSnapshot(
    periods: SettlementPeriod[],
): string {
    const includedPeriods = periods
        .filter(
            (period) =>
                period.settledAt === null &&
                period.status === "complete",
        )
        .sort((a, b) => compareIds(a.id, b.id));

    return JSON.stringify(
        includedPeriods.map((period) => ({
            id: period.id,
            startDate: period.startDate,
            endDate: period.endDate,
            startOdometer: period.startOdometer,
            endOdometer: period.endOdometer,
            amountCents: period.amountCents,
            paidBy: period.paidBy,
            shares: [...period.shares]
                .sort((a, b) =>
                    compareIds(a.userId, b.userId),
                )
                .map((share) => ({
                    userId: share.userId,
                    distance: share.distance,
                    amountCents: share.amountCents,
                })),
        })),
    );
}