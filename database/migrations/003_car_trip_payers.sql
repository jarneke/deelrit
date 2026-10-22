-- Betalers en gasten voor gedeelde ritten.
-- De migratierunner beheert de transactie.
--
-- Zonder expliciete betalers blijft driver_id de enige betaler.
-- Daardoor blijven bestaande ritten en de huidige app werken.
-- Bestaande ritten worden hier niet gekopieerd of herverdeeld.

CREATE TABLE public.car_guest (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id text NOT NULL,
    name text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL
        DEFAULT clock_timestamp(),

    CONSTRAINT car_guest_pkey
        PRIMARY KEY (id),

    CONSTRAINT car_guest_id_organization_key
        UNIQUE (id, organization_id),

    CONSTRAINT car_guest_name_check
        CHECK (
            name = btrim(name)
            AND char_length(name) BETWEEN 1 AND 80
        ),

    CONSTRAINT car_guest_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organization (id)
        ON DELETE CASCADE,

    CONSTRAINT car_guest_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id)
);

CREATE INDEX car_guest_organization_name_idx
    ON public.car_guest (organization_id, name, id);

ALTER TABLE public.car_trip
    ADD CONSTRAINT car_trip_id_organization_key
    UNIQUE (id, organization_id);

CREATE TABLE public.car_trip_payer (
    trip_id uuid NOT NULL,
    organization_id text NOT NULL,
    position smallint NOT NULL,
    user_id text,
    guest_id uuid,

    CONSTRAINT car_trip_payer_pkey
        PRIMARY KEY (trip_id, position),

    CONSTRAINT car_trip_payer_position_check
        CHECK (position BETWEEN 1 AND 5),

    CONSTRAINT car_trip_payer_identity_check
        CHECK (
            (user_id IS NOT NULL AND guest_id IS NULL)
            OR
            (user_id IS NULL AND guest_id IS NOT NULL)
        ),

    CONSTRAINT car_trip_payer_trip_fkey
        FOREIGN KEY (trip_id, organization_id)
        REFERENCES public.car_trip (id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT car_trip_payer_user_fkey
        FOREIGN KEY (user_id)
        REFERENCES public."user" (id),

    CONSTRAINT car_trip_payer_guest_fkey
        FOREIGN KEY (guest_id, organization_id)
        REFERENCES public.car_guest (id, organization_id)
);

CREATE UNIQUE INDEX car_trip_payer_unique_user
    ON public.car_trip_payer (trip_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX car_trip_payer_unique_guest
    ON public.car_trip_payer (trip_id, guest_id)
    WHERE guest_id IS NOT NULL;

CREATE INDEX car_trip_payer_user_idx
    ON public.car_trip_payer (organization_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX car_trip_payer_guest_idx
    ON public.car_trip_payer (guest_id, organization_id)
    WHERE guest_id IS NOT NULL;