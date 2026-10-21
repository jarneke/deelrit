-- Beginschema op basis van de aangeleverde database-export.
-- Vereist PostgreSQL 13 of hoger voor gen_random_uuid().
-- De migratierunner beheert de transactie.
-- Deze migratie is bedoeld voor een lege database.
-- Gebruik baseline voor de bestaande database.

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_pkey PRIMARY KEY (id),
    CONSTRAINT user_email_key UNIQUE (email)
);

CREATE TABLE public.organization (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo text,
    "createdAt" timestamp with time zone NOT NULL,
    metadata text,
    "licensePlate" text,
    CONSTRAINT organization_pkey PRIMARY KEY (id),
    CONSTRAINT organization_slug_key UNIQUE (slug)
);

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT account_pkey PRIMARY KEY (id),
    CONSTRAINT "account_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES public."user" (id)
        ON DELETE CASCADE
);

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL,
    "activeOrganizationId" text,
    CONSTRAINT session_pkey PRIMARY KEY (id),
    CONSTRAINT session_token_key UNIQUE (token),
    CONSTRAINT "session_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES public."user" (id)
        ON DELETE CASCADE
);

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT verification_pkey PRIMARY KEY (id)
);

CREATE TABLE public.member (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    role text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    CONSTRAINT member_pkey PRIMARY KEY (id),
    CONSTRAINT "member_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES public.organization (id)
        ON DELETE CASCADE,
    CONSTRAINT "member_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES public."user" (id)
        ON DELETE CASCADE
);

CREATE TABLE public.invitation (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    email text NOT NULL,
    role text,
    status text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviterId" text NOT NULL,
    CONSTRAINT invitation_pkey PRIMARY KEY (id),
    CONSTRAINT "invitation_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES public.organization (id)
        ON DELETE CASCADE,
    CONSTRAINT "invitation_inviterId_fkey"
        FOREIGN KEY ("inviterId")
        REFERENCES public."user" (id)
        ON DELETE CASCADE
);

CREATE TABLE public.car_startpoint (
    organization_id text NOT NULL,
    tank_date date NOT NULL,
    odometer integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT car_startpoint_pkey PRIMARY KEY (organization_id),
    CONSTRAINT car_startpoint_odometer_check CHECK (odometer >= 0),
    CONSTRAINT car_startpoint_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organization (id)
        ON DELETE CASCADE,
    CONSTRAINT car_startpoint_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id)
);

CREATE TABLE public.car_trip (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id text NOT NULL,
    driver_id text NOT NULL,
    trip_date date NOT NULL,
    start_odometer integer NOT NULL,
    end_odometer integer NOT NULL,
    description text NOT NULL DEFAULT ''::text,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    ended_at timestamp with time zone,
    CONSTRAINT car_trip_pkey PRIMARY KEY (id),
    CONSTRAINT car_trip_start_odometer_check CHECK (start_odometer >= 0),
    CONSTRAINT car_trip_positive_distance
        CHECK (end_odometer > start_odometer),
    CONSTRAINT car_trip_description_check
        CHECK (char_length(description) <= 500),
    CONSTRAINT car_trip_end_date_matches
        CHECK (
            ended_at IS NULL
            OR (ended_at AT TIME ZONE 'Europe/Brussels')::date = trip_date
        ),
    CONSTRAINT car_trip_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.car_startpoint (organization_id)
        ON DELETE CASCADE,
    CONSTRAINT car_trip_driver_id_fkey
        FOREIGN KEY (driver_id)
        REFERENCES public."user" (id),
    CONSTRAINT car_trip_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id)
);

CREATE TABLE public.car_refuel (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id text NOT NULL,
    paid_by text NOT NULL,
    tank_date date NOT NULL,
    odometer integer NOT NULL,
    amount_cents integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    settled_at timestamp with time zone,
    settled_by text,
    CONSTRAINT car_refuel_pkey PRIMARY KEY (id),
    CONSTRAINT car_refuel_unique_odometer
        UNIQUE (organization_id, odometer),
    CONSTRAINT car_refuel_odometer_check CHECK (odometer >= 0),
    CONSTRAINT car_refuel_amount_cents_check CHECK (amount_cents > 0),
    CONSTRAINT car_refuel_settlement_consistent
        CHECK (
            (settled_at IS NULL AND settled_by IS NULL)
            OR (settled_at IS NOT NULL AND settled_by IS NOT NULL)
        ),
    CONSTRAINT car_refuel_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.car_startpoint (organization_id)
        ON DELETE CASCADE,
    CONSTRAINT car_refuel_paid_by_fkey
        FOREIGN KEY (paid_by)
        REFERENCES public."user" (id),
    CONSTRAINT car_refuel_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id),
    CONSTRAINT car_refuel_settled_by_fkey
        FOREIGN KEY (settled_by)
        REFERENCES public."user" (id)
);

CREATE TABLE public.car_invitation_link (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id text NOT NULL,
    created_by text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
        DEFAULT (now() + '24:00:00'::interval),
    revoked_at timestamp with time zone,
    used_at timestamp with time zone,
    used_by text,
    CONSTRAINT car_invitation_link_pkey PRIMARY KEY (id),
    CONSTRAINT car_invitation_link_token_hash_key UNIQUE (token_hash),
    CONSTRAINT invitation_expiry_after_creation
        CHECK (expires_at > created_at),
    CONSTRAINT car_invitation_link_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organization (id)
        ON DELETE CASCADE,
    CONSTRAINT car_invitation_link_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id)
        ON DELETE CASCADE,
    CONSTRAINT car_invitation_link_used_by_fkey
        FOREIGN KEY (used_by)
        REFERENCES public."user" (id)
        ON DELETE SET NULL
);

CREATE TABLE public.car_statement_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id text NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    reopened_at timestamp with time zone,
    period_ids uuid[] NOT NULL,
    snapshot jsonb NOT NULL,
    CONSTRAINT car_statement_history_pkey PRIMARY KEY (id),
    CONSTRAINT car_statement_history_periods_check
        CHECK (cardinality(period_ids) > 0),
    CONSTRAINT car_statement_history_snapshot_check
        CHECK (
            (snapshot ->> 'version') = '1'
            AND jsonb_typeof(snapshot -> 'periods') = 'array'
            AND jsonb_typeof(snapshot -> 'transfers') = 'array'
        ),
    CONSTRAINT car_statement_history_organization_id_fkey
        FOREIGN KEY (organization_id)
        REFERENCES public.organization (id)
        ON DELETE CASCADE,
    CONSTRAINT car_statement_history_created_by_fkey
        FOREIGN KEY (created_by)
        REFERENCES public."user" (id)
        ON DELETE SET NULL
);

CREATE INDEX "account_userId_idx"
    ON public.account ("userId");

CREATE INDEX "session_userId_idx"
    ON public.session ("userId");

CREATE INDEX verification_identifier_idx
    ON public.verification (identifier);

CREATE INDEX "member_organizationId_idx"
    ON public.member ("organizationId");

CREATE INDEX "member_userId_idx"
    ON public.member ("userId");

CREATE INDEX invitation_email_idx
    ON public.invitation (email);

CREATE INDEX "invitation_organizationId_idx"
    ON public.invitation ("organizationId");

CREATE INDEX car_trip_driver_idx
    ON public.car_trip (driver_id);

CREATE INDEX car_trip_organization_ended_at_idx
    ON public.car_trip (organization_id, ended_at DESC);

CREATE INDEX car_trip_organization_odometer_idx
    ON public.car_trip (organization_id, start_odometer, end_odometer);

CREATE INDEX car_refuel_payer_idx
    ON public.car_refuel (paid_by);

CREATE INDEX car_invitation_link_organization_idx
    ON public.car_invitation_link (organization_id);

CREATE INDEX car_statement_history_organization_date_idx
    ON public.car_statement_history (
        organization_id,
        created_at DESC,
        id DESC
    );