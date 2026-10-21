-- Reserveringen per gedeelde auto.
-- De migratierunner beheert de transactie.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.car_reservation (
    id uuid NOT NULL DEFAULT gen_random_uuid(),

    organization_id text NOT NULL,
    reserved_by text NOT NULL,

    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,

    description text NOT NULL DEFAULT '',

    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),

    cancelled_at timestamp with time zone,
    cancelled_by text,

    CONSTRAINT car_reservation_pkey
        PRIMARY KEY (id),

    CONSTRAINT car_reservation_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organization (id)
        ON DELETE CASCADE,

    CONSTRAINT car_reservation_reserved_by_fkey
        FOREIGN KEY (reserved_by)
        REFERENCES public."user" (id),

    CONSTRAINT car_reservation_cancelled_by_fkey
        FOREIGN KEY (cancelled_by)
        REFERENCES public."user" (id),

    CONSTRAINT car_reservation_valid_times
        CHECK (
            isfinite(starts_at)
            AND isfinite(ends_at)
            AND ends_at > starts_at
        ),

    CONSTRAINT car_reservation_description_length
        CHECK (char_length(description) <= 500),

    CONSTRAINT car_reservation_cancellation_consistent
        CHECK (
            (cancelled_at IS NULL AND cancelled_by IS NULL)
            OR
            (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
        ),

    CONSTRAINT car_reservation_no_overlap
        EXCLUDE USING gist (
            organization_id WITH =,
            tstzrange(starts_at, ends_at, '[)') WITH &&
        )
        WHERE (cancelled_at IS NULL)
);

CREATE INDEX car_reservation_organization_start_idx
    ON public.car_reservation (organization_id, starts_at, id)
    WHERE cancelled_at IS NULL;

CREATE INDEX car_reservation_reserved_by_idx
    ON public.car_reservation (reserved_by);

CREATE INDEX car_reservation_cancelled_by_idx
    ON public.car_reservation (cancelled_by)
    WHERE cancelled_by IS NOT NULL;