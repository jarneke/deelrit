-- Onmiddellijke meldingen voor handelingen in Deelrit.
-- Geen planner en geen automatische herhaling.
-- De migratierunner beheert de transactie.

CREATE TABLE public.app_notification_change (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id uuid NOT NULL,
    actor_id text NOT NULL,
    actor_name text NOT NULL,
    organization_id text NOT NULL,
    organization_name text NOT NULL,
    source_table text NOT NULL,
    operation text NOT NULL
        CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    before_row jsonb,
    after_row jsonb,
    trip_snapshot jsonb,
    start_odometer integer,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz
);

CREATE INDEX app_notification_change_batch_idx
    ON public.app_notification_change (batch_id, id);

CREATE INDEX app_notification_change_created_idx
    ON public.app_notification_change (created_at);

CREATE FUNCTION public.capture_app_notification_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
    batch_value text;
    actor_value text;
    actor_display text;
    organization_value text;
    organization_display text;
    old_data jsonb;
    new_data jsonb;
    snapshot_data jsonb;
    start_value integer;
BEGIN
    batch_value := NULLIF(
        current_setting('deelrit.notification_batch', true), ''
    );
    actor_value := NULLIF(
        current_setting('deelrit.notification_actor', true), ''
    );

    IF batch_value IS NULL OR actor_value IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        old_data := to_jsonb(OLD);
    END IF;

    IF TG_OP <> 'DELETE' THEN
        new_data := to_jsonb(NEW);
    END IF;

    IF TG_OP = 'UPDATE'
        AND (old_data - 'updated_at') = (new_data - 'updated_at')
    THEN
        RETURN NULL;
    END IF;

    organization_value := COALESCE(
        new_data->>'organization_id',
        new_data->>'organizationId',
        old_data->>'organization_id',
        old_data->>'organizationId'
    );

    SELECT name INTO actor_display
    FROM public."user"
    WHERE id = actor_value;

    SELECT name INTO organization_display
    FROM public.organization
    WHERE id = organization_value;

    IF actor_display IS NULL OR organization_display IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_TABLE_NAME = 'car_invitation_link' THEN
        old_data := old_data - 'token_hash';
        new_data := new_data - 'token_hash';
    END IF;

    IF TG_TABLE_NAME = 'car_trip' THEN
        SELECT odometer INTO start_value
        FROM public.car_startpoint
        WHERE organization_id = organization_value;

        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'start_odometer', start_odometer,
                    'end_odometer', end_odometer
                )
                ORDER BY start_odometer, end_odometer, id
            ),
            '[]'::jsonb
        )
        INTO snapshot_data
        FROM public.car_trip
        WHERE organization_id = organization_value;
    END IF;

    INSERT INTO public.app_notification_change (
        batch_id,
        actor_id,
        actor_name,
        organization_id,
        organization_name,
        source_table,
        operation,
        before_row,
        after_row,
        trip_snapshot,
        start_odometer
    )
    VALUES (
        batch_value::uuid,
        actor_value,
        actor_display,
        organization_value,
        organization_display,
        TG_TABLE_NAME,
        TG_OP,
        old_data,
        new_data,
        snapshot_data,
        start_value
    );

    RETURN NULL;
END;
$function$;

DO $triggers$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'car_reservation',
        'car_trip',
        'car_trip_payer',
        'car_refuel',
        'car_statement_history',
        'member',
        'car_invitation_link'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER capture_app_notification_change
             AFTER INSERT OR UPDATE OR DELETE ON public.%I
             FOR EACH ROW
             EXECUTE FUNCTION public.capture_app_notification_change()',
            table_name
        );
    END LOOP;
END;
$triggers$;