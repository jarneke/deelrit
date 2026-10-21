import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const organizationId = "test-car";
const refuelId = "11111111-1111-4111-8111-111111111111";
const nextRefuelId = "22222222-2222-4222-8222-222222222222";
const version = "2026-01-02 12:00:00+00";

async function compileAction(relativePath) {
    const url = new URL(relativePath, import.meta.url);
    const source = await readFile(url, "utf8");

    const compiled = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    });

    return compileFunction(
        compiled.outputText,
        ["exports", "require", "module"],
        { filename: fileURLToPath(url) },
    );
}

const createRefuelModule = await compileAction(
    "../src/actions/car-refuels.ts",
);

const deleteRefuelModule = await compileAction(
    "../src/actions/delete-car-refuel.ts",
);

function originalRefuel(overrides = {}) {
    return {
        id: refuelId,
        paid_by: "alice",
        created_by: "alice",
        tank_date: "2026-01-02",
        odometer: 1100,
        amount_cents: 10000,
        settled_at: null,
        version,
        ...overrides,
    };
}

function followingRefuel(overrides = {}) {
    return originalRefuel({
        id: nextRefuelId,
        tank_date: "2026-01-03",
        odometer: 1200,
        settled_at: new Date("2026-01-03T12:00:00Z"),
        ...overrides,
    });
}

function updateInput(overrides = {}) {
    return {
        organizationId,
        refuelId,
        expectedVersion: version,
        paidBy: "alice",
        tankDate: "2026-01-02",
        odometer: 1100,
        amount: "100,00",
        ...overrides,
    };
}

function deleteInput(overrides = {}) {
    return {
        organizationId,
        refuelId,
        expectedVersion: version,
        ...overrides,
    };
}

function createHarness(options = {}) {
    const session = Object.hasOwn(options, "session")
        ? options.session
        : { user: { id: "alice" } };

    const members = options.members ?? [
        { userId: "alice", role: "member" },
        { userId: "bob", role: "member" },
    ];

    const refuels = options.refuels ?? [originalRefuel()];

    const startpoint = Object.hasOwn(options, "startpoint")
        ? options.startpoint
        : {
            tank_date: "2026-01-01",
            odometer: 1000,
        };

    const calls = [];
    const invalidations = [];
    const unexpectedQueries = [];
    const logs = [];

    let connections = 0;
    let releases = 0;

    function rowsResult(rows) {
        return {
            rows: structuredClone(rows),
            rowCount: rows.length,
        };
    }

    const client = {
        async query(statement, parameters = []) {
            const sql = statement.replace(/\s+/g, " ").trim();

            calls.push({
                sql,
                parameters: structuredClone(parameters),
            });

            if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
                return rowsResult([]);
            }

            if (
                sql.startsWith("SELECT") &&
                sql.includes("FROM public.organization")
            ) {
                return rowsResult(
                    options.organizationExists === false
                        ? []
                        : [{ id: organizationId }],
                );
            }

            if (
                sql.startsWith("SELECT") &&
                sql.includes("FROM public.member")
            ) {
                const selectedMembers = parameters.length === 2
                    ? members.filter((member) => member.userId === parameters[1])
                    : members;

                return rowsResult(selectedMembers);
            }

            if (
                sql.startsWith("SELECT") &&
                sql.includes("FROM public.car_refuel")
            ) {
                return rowsResult(refuels);
            }

            if (
                sql.startsWith("SELECT") &&
                sql.includes("FROM public.car_startpoint")
            ) {
                return rowsResult(startpoint ? [startpoint] : []);
            }

            if (
                sql.startsWith("SELECT") &&
                sql.includes("FROM public.car_trip")
            ) {
                return rowsResult(
                    options.tripConflict ? [{ id: "trip-conflict" }] : [],
                );
            }

            if (
                sql.startsWith("UPDATE public.car_refuel") ||
                sql.startsWith("INSERT INTO public.car_refuel") ||
                sql.startsWith("DELETE FROM public.car_refuel")
            ) {
                if (options.writeError) {
                    throw new Error("Gesimuleerde databasefout");
                }

                return {
                    rows: [],
                    rowCount: options.writeCount ?? 1,
                };
            }

            unexpectedQueries.push(sql);
            throw new Error(`Onverwachte testquery: ${sql}`);
        },

        release() {
            releases += 1;
        },
    };

    const dependencies = {
        "next/cache": {
            revalidatePath(path) {
                invalidations.push(path);
            },
        },
        "@/lib/db": {
            db: {
                async connect() {
                    connections += 1;

                    if (options.connectError) {
                        throw new Error("Gesimuleerde verbindingsfout");
                    }

                    return client;
                },
            },
        },
        "@/lib/session": {
            async getSession() {
                return session;
            },
        },
        "@/lib/server-error": {
            logServerError(action, error) {
                logs.push({ action, error });
            },
        },
    };

    function load(factory) {
        const module = { exports: {} };

        factory(
            module.exports,
            (specifier) => {
                if (!Object.hasOwn(dependencies, specifier)) {
                    throw new Error(`Onverwachte import: ${specifier}`);
                }

                return dependencies[specifier];
            },
            module,
        );

        return module.exports;
    }

    return {
        ...load(createRefuelModule),
        ...load(deleteRefuelModule),
        calls,
        invalidations,
        logs,

        get connections() {
            return connections;
        },

        writes() {
            return calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
        },

        checkFinished(expectedTransaction) {
            assert.deepEqual(unexpectedQueries, []);

            if (!options.writeError && !options.connectError) {
                assert.deepEqual(
                    logs,
                    [],
                    "Een geslaagde actie of verwachte validatiefout mag niet gelogd worden",
                );
            }

            const transactions = calls
                .map(({ sql }) => sql)
                .filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql));

            if (expectedTransaction === "none") {
                assert.deepEqual(transactions, []);
                assert.equal(releases, 0);
                return;
            }

            assert.deepEqual(
                transactions,
                ["BEGIN", expectedTransaction === "commit" ? "COMMIT" : "ROLLBACK"],
            );

            assert.equal(releases, 1);

            assert.deepEqual(
                invalidations,
                expectedTransaction === "commit"
                    ? [`/auto/${organizationId}`]
                    : [],
            );
        },
    };
}

function assertRejected(result, message, refreshRequired) {
    assert.equal(result.success, false);
    assert.match(result.error, message);

    if (refreshRequired !== undefined) {
        assert.equal(result.refreshRequired, refreshRequired);
    }
}

for (const action of ["updateCarRefuel", "deleteCarRefuel"]) {
    test(`${action}: zonder sessie wordt geen databaseverbinding gemaakt`, async () => {
        const harness = createHarness({ session: null });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /Log eerst in/);
        assert.equal(harness.connections, 0);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("none");
    });

    test(`${action}: een niet-groepslid krijgt geen toegang`, async () => {
        const harness = createHarness({
            session: { user: { id: "outsider" } },
        });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /geen toegang/);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: een gewoon lid mag andermans tankbeurt niet beheren`, async () => {
        const harness = createHarness({
            session: { user: { id: "bob" } },
        });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /alleen tankbeurten/);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: een verouderde versie wordt geweigerd`, async () => {
        const harness = createHarness();

        const result = await harness[action](
            action === "updateCarRefuel"
                ? updateInput({ expectedVersion: "old-version" })
                : deleteInput({ expectedVersion: "old-version" }),
        );

        assertRejected(result, /ondertussen gewijzigd/, true);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: ook een eigenaar moet een afgerekende periode eerst heropenen`, async () => {
        const harness = createHarness({
            members: [{ userId: "alice", role: "owner" }],
            refuels: [
                originalRefuel({
                    settled_at: new Date("2026-01-02T12:00:00Z"),
                }),
            ],
        });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /afgerekend/, true);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: een verdwenen tankbeurt vraagt om vernieuwen`, async () => {
        const harness = createHarness({ refuels: [] });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /bestaat niet meer/, true);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: een mislukte schrijfactie wordt gelogd en teruggedraaid`, async () => {
        const harness = createHarness({ writeError: true });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /niet.*gelukt|niet worden opgeslagen/);
        assert.equal(harness.writes().length, 1);

        assert.equal(harness.logs.length, 1);
        assert.equal(harness.logs[0].action, action);
        assert.ok(harness.logs[0].error instanceof Error);

        harness.checkFinished("rollback");
    });

    test(`${action}: nul gewijzigde rijen veroorzaakt rollback`, async () => {
        const harness = createHarness({ writeCount: 0 });

        const result = await harness[action](
            action === "updateCarRefuel" ? updateInput() : deleteInput(),
        );

        assertRejected(result, /gewijzigd|niet worden verwijderd/, true);
        assert.equal(harness.writes().length, 1);
        harness.checkFinished("rollback");
    });
}

test("bewerken: een eigenaar mag andermans open tankbeurt aanpassen", async () => {
    const harness = createHarness({
        session: { user: { id: "bob" } },
        members: [
            { userId: "alice", role: "member" },
            { userId: "bob", role: "member, owner" },
        ],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ amount: "72,80" }),
    );

    assert.deepEqual(result, { success: true });
    assert.equal(harness.writes().length, 1);

    const write = harness.writes()[0];

    assert.match(write.sql, /^UPDATE public\.car_refuel/);
    assert.match(write.sql, /updated_at::text = \$7/);
    assert.match(write.sql, /settled_at IS NULL/);

    assert.deepEqual(write.parameters, [
        organizationId,
        refuelId,
        "alice",
        "2026-01-02",
        1100,
        7280,
        version,
    ]);

    harness.checkFinished("commit");
});

test("bewerken: een betaler mag een door iemand anders ingevoerde tankbeurt aanpassen", async () => {
    const harness = createHarness({
        session: { user: { id: "bob" } },
        refuels: [originalRefuel({ paid_by: "bob" })],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ paidBy: "bob" }),
    );

    assert.deepEqual(result, { success: true });
    harness.checkFinished("commit");
});

test("bewerken: de kilometergrens van een volgende afgerekende periode ligt vast", async () => {
    const harness = createHarness({
        refuels: [originalRefuel(), followingRefuel()],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ odometer: 1110 }),
    );

    assertRejected(result, /verandert de afgerekende tankperiode/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("bewerken: de datumgrens van een volgende afgerekende periode ligt vast", async () => {
    const harness = createHarness({
        refuels: [originalRefuel(), followingRefuel()],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ tankDate: "2026-01-01" }),
    );

    assertRejected(result, /verandert de afgerekende tankperiode/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("bewerken: bedrag aanpassen mag als de volgende afgerekende startgrens behouden blijft", async () => {
    const harness = createHarness({
        refuels: [originalRefuel(), followingRefuel()],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ amount: "125,50" }),
    );

    assert.deepEqual(result, { success: true });
    assert.equal(harness.writes()[0].parameters[5], 12550);
    harness.checkFinished("commit");
});

test("toevoegen: een tankbeurt mag geen afgerekende periode opsplitsen", async () => {
    const harness = createHarness({
        refuels: [
            originalRefuel({
                settled_at: new Date("2026-01-02T12:00:00Z"),
            }),
        ],
    });

    const result = await harness.createCarRefuel(
        updateInput({
            odometer: 1050,
            tankDate: "2026-01-01",
        }),
    );

    assertRejected(result, /verandert de afgerekende tankperiode/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("bewerken: een bestaande voormalige betaler kan behouden blijven", async () => {
    const harness = createHarness({
        members: [{ userId: "alice", role: "member" }],
        refuels: [originalRefuel({ paid_by: "former-member" })],
    });

    const result = await harness.updateCarRefuel(
        updateInput({ paidBy: "former-member" }),
    );

    assert.deepEqual(result, { success: true });
    harness.checkFinished("commit");
});

test("bewerken: een andere niet-aangesloten betaler wordt geweigerd", async () => {
    const harness = createHarness();

    const result = await harness.updateCarRefuel(
        updateInput({ paidBy: "outsider" }),
    );

    assertRejected(result, /betaler is geen lid/);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("bewerken: tegenstrijdige ritgegevens blokkeren opslaan", async () => {
    const harness = createHarness({ tripConflict: true });

    const result = await harness.updateCarRefuel(updateInput());

    assertRejected(result, /passen niet bij de geregistreerde ritten/);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("verwijderen: de startgrens van een volgende afgerekende periode blijft beschermd", async () => {
    const harness = createHarness({
        refuels: [originalRefuel(), followingRefuel()],
    });

    const result = await harness.deleteCarRefuel(deleteInput());

    assertRejected(result, /startgrens van een afgerekende periode/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("verwijderen: een eigenaar mag andermans open tankbeurt verwijderen", async () => {
    const harness = createHarness({
        session: { user: { id: "bob" } },
        members: [
            { userId: "alice", role: "member" },
            { userId: "bob", role: "owner" },
        ],
    });

    const result = await harness.deleteCarRefuel(deleteInput());

    assert.deepEqual(result, { success: true });
    assert.equal(harness.writes().length, 1);

    const write = harness.writes()[0];

    assert.match(write.sql, /^DELETE FROM public\.car_refuel/);
    assert.match(write.sql, /updated_at::text = \$3/);
    assert.match(write.sql, /settled_at IS NULL/);

    assert.deepEqual(write.parameters, [
        organizationId,
        refuelId,
        version,
    ]);

    harness.checkFinished("commit");
});

test("toevoegen: een geldige tankbeurt wordt met bedrag in centen opgeslagen", async () => {
    const harness = createHarness({ refuels: [] });

    const result = await harness.createCarRefuel(
        updateInput({ amount: "72,80" }),
    );

    assert.deepEqual(result, { success: true });
    assert.equal(harness.writes().length, 1);

    const write = harness.writes()[0];

    assert.match(write.sql, /^INSERT INTO public\.car_refuel/);

    assert.deepEqual(write.parameters, [
        organizationId,
        "alice",
        "2026-01-02",
        1100,
        7280,
        "alice",
    ]);

    harness.checkFinished("commit");
});