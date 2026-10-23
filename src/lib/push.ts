import "server-only";

import { createHash } from "node:crypto";
import webpush from "web-push";

export type PushRegistration = {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
};

export function endpointHash(endpoint: string): string {
    return createHash("sha256").update(endpoint).digest("hex");
}

export function validPushEndpoint(value: unknown): value is string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 4096
    ) {
        return false;
    }

    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();

        const allowed =
            host === "web.push.apple.com" ||
            host.endsWith(".push.apple.com") ||
            host === "fcm.googleapis.com" ||
            host === "updates.push.services.mozilla.com" ||
            host.endsWith(".push.services.mozilla.com");

        return (
            allowed &&
            url.protocol === "https:" &&
            url.port === "" &&
            url.username === "" &&
            url.password === "" &&
            url.hash === ""
        );
    } catch {
        return false;
    }
}

export function parsePushRegistration(
    input: unknown,
): PushRegistration | null {
    if (!input || typeof input !== "object") {
        return null;
    }

    const value = input as Record<string, unknown>;

    if (
        !validPushEndpoint(value.endpoint) ||
        !value.keys ||
        typeof value.keys !== "object"
    ) {
        return null;
    }

    const keys = value.keys as Record<string, unknown>;

    if (
        typeof keys.p256dh !== "string" ||
        typeof keys.auth !== "string" ||
        !/^[A-Za-z0-9_-]{87}={0,2}$/.test(keys.p256dh) ||
        !/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth)
    ) {
        return null;
    }

    const publicKey = Buffer.from(keys.p256dh, "base64url");
    const authSecret = Buffer.from(keys.auth, "base64url");

    if (
        publicKey.length !== 65 ||
        publicKey[0] !== 4 ||
        authSecret.length !== 16
    ) {
        return null;
    }

    return {
        endpoint: value.endpoint,
        keys: {
            p256dh: keys.p256dh,
            auth: keys.auth,
        },
    };
}

export function pushConfigured(): boolean {
    return Boolean(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT,
    );
}

export function pushStatusCode(error: unknown): number | undefined {
    if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
    ) {
        return error.statusCode;
    }

    return undefined;
}

export async function deliverPush(
    subscription: PushRegistration,
    message: {
        title: string;
        body: string;
        url: string;
        tag: string;
    },
): Promise<void> {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
        throw new Error("Pushconfiguratie ontbreekt.");
    }

    if (!validPushEndpoint(subscription.endpoint)) {
        throw new Error("Ongeldige pushbestemming.");
    }

    await webpush.sendNotification(
        subscription,
        JSON.stringify(message),
        {
            TTL: 60,
            urgency: "high",
            timeout: 10_000,
            vapidDetails: {
                subject,
                publicKey,
                privateKey,
            },
        },
    );
}