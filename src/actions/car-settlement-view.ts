"use server";

import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import {
    CarOverviewAccessError,
    loadCarOverview,
} from "@/lib/car-overview";
import { settleCarStatement } from "@/actions/car-settlement";
import type {
    SettlementPeriodPage,
    SettlementViewResult,
    TransferDetailPage,
} from "@/lib/car-settlement-view-types";

type Overview = Awaited<ReturnType<typeof loadCarOverview>>;

const PAGE_SIZE = 5;

function validId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 128
    );
}

function validPage(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 1_000_000
    );
}

function currentPage(requestedPage: number, total: number) {
    return Math.min(
        requestedPage,
        Math.max(0, Math.ceil(total / PAGE_SIZE) - 1),
    );
}

async function withOverview<T>(
    organizationId: string,
    actionName: string,
    resolve: (
        overview: Overview,
    ) => SettlementViewResult<T> | Promise<SettlementViewResult<T>>,
): Promise<SettlementViewResult<T>> {
    if (!validId(organizationId)) {
        return {
            success: false,
            error: "Ongeldige auto.",
        };
    }

    try {
        const session = await getSession();

        if (!session) {
            return {
                success: false,
                error: "Log eerst in.",
            };
        }

        const overview = await loadCarOverview(
            organizationId,
            session.user.id,
        );

        if (!overview.settlement || !overview.settlementOverview) {
            return {
                success: false,
                error: "Stel eerst het startpunt van deze auto in.",
                refreshRequired: true,
            };
        }

        return await resolve(overview);
    } catch (error) {
        if (!(error instanceof CarOverviewAccessError)) {
            logServerError(actionName, error);
        }

        return {
            success: false,
            error:
                error instanceof CarOverviewAccessError
                    ? error.message
                    : "De afrekengegevens konden niet worden verwerkt. Probeer opnieuw.",
        };
    }
}

export async function getCarPeriodPage(
    organizationId: string,
    settled: boolean,
    requestedPage: number,
): Promise<SettlementViewResult<SettlementPeriodPage>> {
    if (typeof settled !== "boolean" || !validPage(requestedPage)) {
        return {
            success: false,
            error: "Ongeldige tankperiodepagina.",
        };
    }

    return withOverview<SettlementPeriodPage>(
        organizationId,
        "getCarPeriodPage",
        (overview) => {
            const settlement = overview.settlement;
            const summary = overview.settlementOverview;

            if (!settlement || !summary) {
                return {
                    success: false,
                    error: "De afrekening is niet beschikbaar.",
                    refreshRequired: true,
                };
            }

            const periods = [
                ...(settled
                    ? settlement.settledPeriods
                    : settlement.periods),
            ].reverse();

            const page = currentPage(requestedPage, periods.length);
            const offset = page * PAGE_SIZE;

            return {
                success: true,
                data: {
                    items: periods.slice(offset, offset + PAGE_SIZE),
                    total: periods.length,
                    page,
                    pageSize: PAGE_SIZE,
                    revision: summary.revision,
                },
            };
        },
    );
}

export async function getCarTransferPage(
    organizationId: string,
    fromUserId: string,
    toUserId: string,
    requestedPage: number,
): Promise<SettlementViewResult<TransferDetailPage>> {
    if (
        !validId(fromUserId) ||
        !validId(toUserId) ||
        !validPage(requestedPage)
    ) {
        return {
            success: false,
            error: "Ongeldige betaling of pagina.",
        };
    }

    return withOverview<TransferDetailPage>(
        organizationId,
        "getCarTransferPage",
        (overview) => {
            const summary = overview.settlementOverview;

            const transfer = overview.settlement?.transfers.find(
                (entry) =>
                    entry.fromUserId === fromUserId &&
                    entry.toUserId === toUserId,
            );

            if (!transfer || !summary) {
                return {
                    success: false,
                    error:
                        "Deze betaling is ondertussen veranderd. Vernieuw het overzicht.",
                    refreshRequired: true,
                };
            }

            const sourceTotal = transfer.sources.length;
            const offsetSourceTotal = transfer.offsetSources.length;

            const page = currentPage(
                requestedPage,
                Math.max(sourceTotal, offsetSourceTotal),
            );

            const offset = page * PAGE_SIZE;

            return {
                success: true,
                data: {
                    transfer: {
                        ...transfer,
                        sources: transfer.sources.slice(
                            offset,
                            offset + PAGE_SIZE,
                        ),
                        offsetSources: transfer.offsetSources.slice(
                            offset,
                            offset + PAGE_SIZE,
                        ),
                    },
                    sourceTotal,
                    offsetSourceTotal,
                    page,
                    pageSize: PAGE_SIZE,
                    revision: summary.revision,
                },
            };
        },
    );
}

export async function finishCarStatement(
    organizationId: string,
    expectedSnapshot: string,
): Promise<SettlementViewResult<null>> {
    if (
        typeof expectedSnapshot !== "string" ||
        !/^[a-f0-9]{64}$/.test(expectedSnapshot)
    ) {
        return {
            success: false,
            error:
                "Het overzicht kon niet worden gecontroleerd. Vernieuw de pagina.",
            refreshRequired: true,
        };
    }

    return withOverview<null>(
        organizationId,
        "finishCarStatement",
        async (overview) => {
            const summary = overview.settlementOverview;
            const snapshot = overview.statementSnapshot;

            if (
                !summary ||
                snapshot === null ||
                summary.expectedSnapshot !== expectedSnapshot
            ) {
                return {
                    success: false,
                    error:
                        "De afrekening is ondertussen veranderd. Vernieuw het overzicht en controleer de bedragen.",
                    refreshRequired: true,
                };
            }

            // Deze bestaande actie controleert eigenaarstoegang en vergelijkt
            // opnieuw de volledige snapshot binnen de schrijftransactie.
            const result = await settleCarStatement(
                organizationId,
                snapshot,
            );

            if (!result.success) {
                return result;
            }

            return {
                success: true,
                data: null,
            };
        },
    );
}