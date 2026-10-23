"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";
import {
    deliverPush,
    endpointHash,
    parsePushRegistration,
    pushConfigured,
    pushStatusCode,
    validPushEndpoint,
} from "@/lib/push";

type Result =
    | { success: true; enabled?: boolean }
    | { success: false; error: string };

export async function getPushStatus(
    endpoint: string,
): Promise<Result> {
    try {
        const session = await getSession();

        if (!session) {
            return { success: false, error: "Log eerst in." };
        }

        if (!validPushEndpoint(endpoint)) {
            return {
                success: false,
                error: "Ongeldige registratie. Schakel meldingen opnieuw in.",
            };
        }

        const result = await db.query(
            `
        SELECT 1
        FROM public.push_subscription AS subscription
        JOIN public.session AS login
          ON login.id = subscription.session_id
        WHERE subscription.endpoint_hash = $1
          AND subscription.endpoint = $2
          AND login.id = $3
          AND login."userId" = $4
          AND login."expiresAt" > clock_timestamp()
      `,
            [
                endpointHash(endpoint),
                endpoint,
                session.session.id,
                session.user.id,
            ],
        );

        return {
            success: true,
            enabled: result.rowCount === 1,
        };
    } catch (error) {
        logServerError("getPushStatus", error);

        return {
            success: false,
            error: "Je meldingen konden niet worden gecontroleerd.",
        };
    }
}

export async function enablePush(
    input: unknown,
): Promise<Result> {
    try {
        const session = await getSession();

        if (!session) {
            return { success: false, error: "Log eerst in." };
        }

        if (!pushConfigured()) {
            return {
                success: false,
                error: "Meldingen zijn nog niet beschikbaar. Probeer later opnieuw.",
            };
        }

        const subscription = parsePushRegistration(input);

        if (!subscription) {
            return {
                success: false,
                error: "Ongeldige registratie. Probeer meldingen opnieuw in te schakelen.",
            };
        }

        const result = await db.query(
            `
        INSERT INTO public.push_subscription (
          endpoint_hash,
          endpoint,
          p256dh,
          auth,
          session_id
        )
        SELECT $1, $2, $3, $4, login.id
        FROM public.session AS login
        WHERE login.id = $5
          AND login."userId" = $6
          AND login."expiresAt" > clock_timestamp()
        ON CONFLICT (endpoint_hash)
        DO UPDATE SET
          endpoint = EXCLUDED.endpoint,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          session_id = EXCLUDED.session_id,
          updated_at = clock_timestamp()
      `,
            [
                endpointHash(subscription.endpoint),
                subscription.endpoint,
                subscription.keys.p256dh,
                subscription.keys.auth,
                session.session.id,
                session.user.id,
            ],
        );

        if (result.rowCount !== 1) {
            return {
                success: false,
                error: "Je sessie is verlopen. Log opnieuw in.",
            };
        }

        return { success: true, enabled: true };
    } catch (error) {
        logServerError("enablePush", error);

        return {
            success: false,
            error: "Meldingen inschakelen is niet gelukt. Probeer opnieuw.",
        };
    }
}

export async function disablePush(
    endpoint: string,
): Promise<Result> {
    try {
        const session = await getSession();

        if (!session) {
            return { success: false, error: "Log eerst in." };
        }

        if (!validPushEndpoint(endpoint)) {
            return {
                success: false,
                error: "Ongeldige registratie.",
            };
        }

        await db.query(
            `
        DELETE FROM public.push_subscription
        WHERE endpoint_hash = $1
          AND endpoint = $2
          AND session_id = $3
      `,
            [
                endpointHash(endpoint),
                endpoint,
                session.session.id,
            ],
        );

        return { success: true, enabled: false };
    } catch (error) {
        logServerError("disablePush", error);

        return {
            success: false,
            error: "Meldingen uitschakelen is niet gelukt. Probeer opnieuw.",
        };
    }
}

export async function sendPushTest(
    endpoint: string,
): Promise<Result> {
    try {
        const session = await getSession();

        if (!session) {
            return { success: false, error: "Log eerst in." };
        }

        if (!pushConfigured()) {
            return {
                success: false,
                error: "Meldingen zijn nog niet beschikbaar. Probeer later opnieuw.",
            };
        }

        if (!validPushEndpoint(endpoint)) {
            return { success: false, error: "Ongeldige registratie." };
        }

        const result = await db.query<{
            endpoint: string;
            p256dh: string;
            auth: string;
        }>(
            `
        UPDATE public.push_subscription AS subscription
        SET last_test_at = clock_timestamp()
        FROM public.session AS login
        WHERE login.id = subscription.session_id
          AND login.id = $1
          AND login."userId" = $2
          AND login."expiresAt" > clock_timestamp()
          AND subscription.endpoint_hash = $3
          AND subscription.endpoint = $4
          AND (
            subscription.last_test_at IS NULL
            OR subscription.last_test_at
              < clock_timestamp() - INTERVAL '30 seconds'
          )
        RETURNING
          subscription.endpoint,
          subscription.p256dh,
          subscription.auth
      `,
            [
                session.session.id,
                session.user.id,
                endpointHash(endpoint),
                endpoint,
            ],
        );

        const subscription = result.rows[0];

        if (!subscription) {
            return {
                success: false,
                error:
                    "Schakel meldingen in voor dit account. Heb je net getest? Wacht dan 30 seconden.",
            };
        }

        try {
            await deliverPush(
                {
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh,
                        auth: subscription.auth,
                    },
                },
                {
                    title: "Deelrit",
                    body: "Het werkt! Dit toestel kan meldingen van Deelrit ontvangen.",
                    url: "/account",
                    tag: "deelrit-test",
                },
            );
        } catch (error) {
            const status = pushStatusCode(error);

            if (status === 404 || status === 410) {
                await db.query(
                    `
            DELETE FROM public.push_subscription
            WHERE endpoint_hash = $1
              AND session_id = $2
              AND p256dh = $3
              AND auth = $4
          `,
                    [
                        endpointHash(endpoint),
                        session.session.id,
                        subscription.p256dh,
                        subscription.auth,
                    ],
                );

                return {
                    success: false,
                    error:
                        "Deze registratie is verlopen. Zet meldingen uit en opnieuw aan.",
                };
            }

            throw error;
        }

        return { success: true };
    } catch (error) {
        logServerError("sendPushTest", error);

        return {
            success: false,
            error: "De testmelding kon niet worden verstuurd. Probeer opnieuw.",
        };
    }
}