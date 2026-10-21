import type { HistoryPage } from "./car-history-types";
import type {
    SettlementPeriod,
    SettlementTransfer,
} from "./car-settlement";

export type SettlementTransferSummary = Omit<
    SettlementTransfer,
    "sources" | "offsetSources"
>;

export type SettlementOverview = {
    transfers: SettlementTransferSummary[];
    completePeriodCount: number;
    incompletePeriodCount: number;
    openPeriodCount: number;
    settledPeriodCount: number;
    firstCompleteDate: string | null;
    lastCompleteDate: string | null;
    expectedSnapshot: string;
    revision: string;
};

export type SettlementPeriodPage = HistoryPage<SettlementPeriod> & {
    revision: string;
};

export type TransferDetailPage = {
    transfer: SettlementTransfer;
    sourceTotal: number;
    offsetSourceTotal: number;
    page: number;
    pageSize: number;
    revision: string;
};

export type SettlementViewResult<T> =
    | {
        success: true;
        data: T;
    }
    | {
        success: false;
        error: string;
        refreshRequired?: boolean;
    };