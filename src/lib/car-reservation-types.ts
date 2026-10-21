export type CarReservation = {
    id: string;
    reservedBy: string;
    reservedByName: string;
    startsAt: string;
    endsAt: string;
    description: string;
    version: string;
};

export type ReservationWeek = {
    weekStart: string;
    nextWeekStart: string;
    serverNow: string;
    items: CarReservation[];
};

export type ReservationWeekResult =
    | {
        success: true;
        data: ReservationWeek;
    }
    | {
        success: false;
        error: string;
    };