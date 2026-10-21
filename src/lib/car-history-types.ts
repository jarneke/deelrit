export type HistoryStartpoint = {
    tankDate: string;
    odometer: number;
};

export type TripHistoryItem = {
    id: string;
    driverId: string;
    driverName: string;
    createdBy: string;
    version: string;
    tripDate: string;
    endedAt: string | null;
    startOdometer: number;
    endOdometer: number;
    description: string;
    settledLocked: boolean;
};

export type RefuelHistoryItem = {
    id: string;
    paidBy: string;
    payerName: string;
    createdBy: string;
    version: string;
    tankDate: string;
    odometer: number;
    amountCents: number;
    settledAt: string | null;
    boundaryLocked: boolean;
    nextRefuel: {
        tankDate: string;
        settledAt: string | null;
    } | null;
};

export type RefuelHistoryEntry =
    | {
        kind: "refuel";
        refuel: RefuelHistoryItem;
    }
    | {
        kind: "startpoint";
        startpoint: HistoryStartpoint;
    };

export type HistoryPage<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

export type HistoryResult<T> =
    | {
        success: true;
        data: HistoryPage<T>;
    }
    | {
        success: false;
        error: string;
    };