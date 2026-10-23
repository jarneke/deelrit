CREATE TABLE public.push_subscription (
    endpoint_hash text PRIMARY KEY,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    session_id text NOT NULL
        REFERENCES public.session (id)
        ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_test_at timestamptz,

    CONSTRAINT push_subscription_hash_check
        CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT push_subscription_endpoint_check
        CHECK (char_length(endpoint) BETWEEN 1 AND 4096),

    CONSTRAINT push_subscription_p256dh_check
        CHECK (char_length(p256dh) BETWEEN 87 AND 89),

    CONSTRAINT push_subscription_auth_check
        CHECK (char_length(auth) BETWEEN 22 AND 24)
);

CREATE INDEX push_subscription_session_idx
    ON public.push_subscription (session_id);