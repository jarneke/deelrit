import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;

const migrationsDirectory = new URL("../database/migrations/", import.meta.url);
const baselineName = "001_initial_schema.sql";

const expectedTables = [
    "account",
    "car_invitation_link",
    "car_refuel",
    "car_startpoint",
    "car_statement_history",
    "car_trip",
    "invitation",
    "member",
    "organization",
    "session",
    "user",
    "verification",
];

const command = process.argv[2] ?? "status";
const validCommands = new Set(["status", "baseline", "up"]);

function checksum(sql) {
    return createHash("sha256").update(sql).digest("hex");
}

async function loadMigrations() {
    const entries = await readdir(migrationsDirectory, {
        withFileTypes: true,
    });

    const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort();

    if (names.length === 0 || names[0] !== baselineName) {
        throw new Error(`De eerste migratie moet ${baselineName} zijn.`);
    }

    const versions = new Set();
    const migrations = [];

    for (const name of names) {
        const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(name);

        if (!match) {
            throw new Error(`Ongeldige migratienaam: ${name}`);
        }

        if (versions.has(match[1])) {
            throw new Error(`Dubbel migratienummer: ${match[1]}`);
        }

        versions.add(match[1]);

        const sql = (await readFile(new URL(name, migrationsDirectory), "utf8"))
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?/g, "\n");

        if (!sql.trim()) {
            throw new Error(`Migratie is leeg: ${name}`);
        }

        migrations.push({
            name,
            sql,
            checksum: checksum(sql),
        });
    }

    return migrations;
}

async function readAppliedMigrations(client) {
    const result = await client.query(`
    SELECT to_regclass('public.deelrit_schema_migrations') AS registry
  `);

    if (result.rows[0].registry === null) {
        return [];
    }

    const applied = await client.query(`
    SELECT name, checksum
    FROM public.deelrit_schema_migrations
    ORDER BY name
  `);

    return applied.rows;
}

function validateHistory(migrations, applied) {
    for (let index = 0; index < applied.length; index += 1) {
        const recorded = applied[index];
        const migration = migrations[index];

        if (!migration || migration.name !== recorded.name) {
            throw new Error(
                `Migratiegeschiedenis wijkt af bij ${recorded.name}. ` +
                "Herstel ontbrekende bestanden en voeg nieuwe migraties achteraan toe.",
            );
        }

        if (migration.checksum !== recorded.checksum) {
            throw new Error(
                `Uitgevoerde migratie is gewijzigd: ${recorded.name}. ` +
                "Herstel het oorspronkelijke bestand en maak een nieuwe migratie.",
            );
        }
    }
}

async function listPublicTables(client) {
    const result = await client.query(`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'deelrit_schema_migrations'
    ORDER BY tablename
  `);

    return result.rows.map((row) => row.tablename);
}

async function createRegistry(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS public.deelrit_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
}

async function recordMigration(client, migration) {
    await client.query(
        `
      INSERT INTO public.deelrit_schema_migrations (name, checksum)
      VALUES ($1, $2)
    `,
        [migration.name, migration.checksum],
    );
}

async function showStatus(client, migrations) {
    await client.query("BEGIN READ ONLY");

    try {
        const applied = await readAppliedMigrations(client);
        validateHistory(migrations, applied);

        const appliedNames = new Set(applied.map((migration) => migration.name));

        for (const migration of migrations) {
            const state = appliedNames.has(migration.name)
                ? "uitgevoerd"
                : "openstaand";

            console.log(`${state}: ${migration.name}`);
        }

        if (applied.length === 0) {
            const tables = await listPublicTables(client);

            console.log(
                tables.length > 0
                    ? "Bestaande database zonder migratieregister: gebruik baseline nadat het schema gecontroleerd is."
                    : "Lege database: gebruik up om het beginschema aan te maken.",
            );
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function changeDatabase(client, migrations) {
    await client.query("BEGIN");

    try {
        await client.query(`
      SELECT pg_advisory_xact_lock(174238, 1)
    `);

        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '120s'");

        const applied = await readAppliedMigrations(client);
        validateHistory(migrations, applied);

        if (command === "baseline") {
            if (applied.length > 0) {
                throw new Error(
                    "Deze database heeft al geregistreerde migraties. Gebruik status of up.",
                );
            }

            const tables = await listPublicTables(client);
            const missing = expectedTables.filter((table) => !tables.includes(table));
            const unexpected = tables.filter(
                (table) => !expectedTables.includes(table),
            );

            if (missing.length > 0 || unexpected.length > 0) {
                throw new Error(
                    "Baseline geweigerd. " +
                    `Ontbrekende tabellen: ${missing.join(", ") || "geen"}. ` +
                    `Onverwachte tabellen: ${unexpected.join(", ") || "geen"}.`,
                );
            }

            await createRegistry(client);
            await recordMigration(client, migrations[0]);
            await client.query("COMMIT");

            console.log(
                `${baselineName} geregistreerd als bestaand schema. ` +
                "De SQL van deze migratie is niet uitgevoerd.",
            );

            return;
        }

        if (applied.length === 0) {
            const tables = await listPublicTables(client);

            if (tables.length > 0) {
                throw new Error(
                    "De database bevat al tabellen. " +
                    "Controleer het schema en gebruik eerst baseline.",
                );
            }
        }

        const pending = migrations.slice(applied.length);

        if (pending.length === 0) {
            await client.query("COMMIT");
            console.log("Geen openstaande migraties.");
            return;
        }

        await createRegistry(client);

        for (const migration of pending) {
            await client.query(migration.sql);
            await recordMigration(client, migration);
        }

        await client.query("COMMIT");

        for (const migration of pending) {
            console.log(`Uitgevoerd: ${migration.name}`);
        }
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function main() {
    if (!validCommands.has(command) || process.argv.length > 3) {
        throw new Error(
            "Gebruik: node scripts/migrate.mjs [status|baseline|up]",
        );
    }

    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL ontbreekt. Laad je omgevingsbestand bij het starten.",
        );
    }

    const migrations = await loadMigrations();

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 10_000,
        application_name: "deelrit-migrations",
    });

    try {
        await client.connect();

        if (command === "status") {
            await showStatus(client, migrations);
        } else {
            await changeDatabase(client, migrations);
        }
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(
        error instanceof Error ? error.message : "Migratiecommando mislukt.",
    );
    process.exitCode = 1;
});