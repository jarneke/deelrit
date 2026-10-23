import "server-only";

import { randomUUID } from "node:crypto";
import {
    Pool,
    type PoolClient,
    type QueryResult,
} from "pg";
import { after } from "next/server";
import { getSession } from "@/lib/session";
import { logServerError } from "@/lib/server-error";

const globalForDatabase = globalThis as unknown as {
    deelritPool?: Pool;
};

const pool =
    globalForDatabase.deelritPool ??
    new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
    });

if (process.env.NODE_ENV !== "production") {
    globalForDatabase.deelritPool = pool;
}

function scheduleNotifications(batchId: string): void {
    try {
        after(async () => {
            try {
                const { sendAppNotifications } = await import(
                    "@/lib/app-notifications"
                );

                await sendAppNotifications(batchId);
            } catch (error) {
                logServerError("notifications.sendBatch", error);
            }
        });
    } catch (error) {
        logServerError("notifications.schedule", error);
    }
}

function notificationClient(client: PoolClient): PoolClient {
    let batchId: string | null = null;

    const query = client.query.bind(client) as (
        input: unknown,
        values?: unknown,
    ) => Promise<QueryResult>;

    async function trackedQuery(
        input: unknown,
        values?: unknown,
    ): Promise<QueryResult> {
        const text =
            typeof input === "string"
                ? input
                : input &&
                    typeof input === "object" &&
                    "text" in input
                    ? String(input.text)
                    : "";

        const sql = text.trim();

        if (
            /^BEGIN\b/i.test(sql) &&
            !/\bREAD\s+ONLY\b/i.test(sql)
        ) {
            const session = await getSession();
            const result = await query(input, values);
            batchId = null;

            if (session) {
                try {
                    const nextBatch = randomUUID();

                    await query(
                        "SELECT set_config('deelrit.notification_batch', $1, true), set_config('deelrit.notification_actor', $2, true)",
                        [nextBatch, session.user.id],
                    );

                    batchId = nextBatch;
                } catch (error) {
                    try {
                        await query("ROLLBACK");
                    } catch (rollbackError) {
                        logServerError(
                            "notifications.beginRollback",
                            rollbackError,
                        );
                    }

                    throw error;
                }
            }

            return result;
        }

        const result = await query(input, values);

        if (/^(COMMIT|END)\s*;?$/i.test(sql)) {
            const committedBatch = batchId;
            batchId = null;

            if (
                result.command === "COMMIT" &&
                committedBatch
            ) {
                scheduleNotifications(committedBatch);
            }
        } else if (/^(ROLLBACK|ABORT)\s*;?$/i.test(sql)) {
            batchId = null;
        }

        return result;
    }

    return new Proxy(client, {
        get(target, property) {
            if (property === "query") {
                return trackedQuery;
            }

            const value: unknown = Reflect.get(
                target,
                property,
                target,
            );

            return typeof value === "function"
                ? value.bind(target)
                : value;
        },
    });
}

export const db = {
    query: pool.query.bind(pool) as Pool["query"],

    async connect(): Promise<PoolClient> {
        return notificationClient(await pool.connect());
    },
};