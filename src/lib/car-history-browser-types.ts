import type {
    HistoryStartpoint,
    RefuelHistoryItem,
    TripHistoryItem,
} from "@/lib/car-history-types";

export type HistoryBrowserKind = "trips" | "refuels";

export type HistoryBrowserStatus = "all" | "open" | "settled";

export type HistoryBrowserSort =
    | "date-desc"
    | "date-asc"
    | "odometer-desc"
    | "odometer-asc"
    | "value-desc"
    | "value-asc";

export type HistoryBrowserPageSize = 5 | 10 | 20 | 50;

export type HistoryBrowserFilters = {
    kind: HistoryBrowserKind;
    search: string;
    person: string;
    from: string;
    to: string;
    status: HistoryBrowserStatus;
    sort: HistoryBrowserSort;
    page: number;
    pageSize: HistoryBrowserPageSize;
};

export type HistoryBrowserPerson = {
    id: string;
    name: string;
};

export type HistoryBrowserData = {
    filters: HistoryBrowserFilters;
    total: number;
    pageCount: number;
    trips: TripHistoryItem[];
    refuels: RefuelHistoryItem[];
    people: HistoryBrowserPerson[];
    startpoint: HistoryStartpoint | null;
    currentUserId: string;
    isOwner: boolean;
};

export type HistoryBrowserResult =
    | {
        success: true;
        data: HistoryBrowserData;
    }
    | {
        success: false;
        error: string;
    };