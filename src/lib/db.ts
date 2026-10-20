import "server-only";

import { Pool } from "pg";

const globalForDatabase = globalThis as unknown as {
    deelritPool?: Pool;
};

export const db =
    globalForDatabase.deelritPool ??
    new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
    });

if (process.env.NODE_ENV !== "production") {
    globalForDatabase.deelritPool = db;
}