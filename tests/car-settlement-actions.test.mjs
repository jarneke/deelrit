import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { calculateCarSettlement } from "../src/lib/car-settlement.ts";
import { getCarSettlementSnapshot } from "../src/lib/car-settlement-snapshot.ts";

const organizationId = "test-car";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const unknownId = "33333333-3333-4333-8333-333333333333";
const actionUrl = new URL("../src/actions/car-settlement.ts", import.meta.url);
const source = await readFile(actionUrl, "utf8");
const compiled = ts.transpileModule(source, {
    fileName: fileURLToPath(actionUrl),
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
    },
});
const createActionModule = compileFunction(
    compiled.outputText,
    ["exports", "require", "module"],
    { filename: fileURLToPath(actionUrl) },
);

function firstRefuel(overrides = {}) {
    return {
        id: firstId,
        paid_by: "alice",
        payer_name: "Alice",
        tank_date: "2026-01-02",
        odometer: 1100,
        amount_cents: 10000,
        settled_at: null,
        ...overrides,
    };
}

function secondRefuel(overrides = {}) {
    return firstRefuel({
        id: secondId,
        paid_by: "bob",
        payer_name: "Bob",
        tank_date: "2026-01-03",
        odometer: 1200,
        amount_cents: 6000,
        ...overrides,
    });
}

function createHarness(options = {}) {
    const session = Object.hasOwn(options, "session")
        ? options.session
        : { user: { id: "alice" } };
    const role = Object.hasOwn(options, "role") ? options.role : "owner";
    const startpoint = Object.hasOwn(options, "startpoint")
        ? options.startpoint
        : { tank_date: "2026-01-01", odometer: 1000 };
    const refuels = options.refuels ?? [firstRefuel(), secondRefuel()];
    const trips = options.trips ?? [
        {
            driver_id: "bob",
            driver_name: "Bob",
            start_odometer: 1000,
            end_odometer: 1100,
        },
        {
            driver_id: "alice",
            driver_name: "Alice",
            start_odometer: 1100,
            end_odometer: 1200,
        },
    ];

    const calls = [];
    const invalidations = [];
    const unexpectedQueries = [];
    const logs = [];
    let connections = 0;
    let releases = 0;

    function rowsResult(rows) {
        return { rows: structuredClone(rows), rowCount: rows.length };
    }

    async function query(statement, parameters = []) {
        const sql = statement.replace(/\s+/g, " ").trim();
        calls.push({ sql, parameters: structuredClone(parameters) });

        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
            return rowsResult([]);
        }
        if (sql.startsWith("WITH access AS")) {
            return rowsResult([
                options.history ?? { authorized: true, total: 0, items: [] },
            ]);
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM public.organization")) {
            return rowsResult(
                options.organizationExists === false
                    ? []
                    : [{ id: organizationId }],
            );
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM public.member")) {
            return rowsResult(role === null ? [] : [{ role }]);
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM public.car_startpoint")) {
            return rowsResult(startpoint ? [startpoint] : []);
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM public.car_refuel")) {
            return rowsResult(refuels);
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM public.car_trip")) {
            return rowsResult(trips);
        }
        if (sql.startsWith('SELECT name FROM public."user"')) {
            return rowsResult([{ name: "Alice" }]);
        }
        if (sql.startsWith("INSERT INTO public.car_statement_history")) {
            if (options.historyError) {
                throw new Error("Gesimuleerde archieffout");
            }
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE public.car_statement_history")) {
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE public.car_refuel")) {
            if (options.updateError) {
                throw new Error("Gesimuleerde updatefout");
            }
            const selected = parameters[1];
            return {
                rows: [],
                rowCount:
                    options.updateCount ??
                    (Array.isArray(selected) ? selected.length : 1),
            };
        }

        unexpectedQueries.push(sql);
        throw new Error(`Onverwachte testquery: ${sql}`);
    }

    const dependencies = {
        "@/lib/car-trip-payers-server": {
            async loadCarTripPayers(client, carId, tripIds) {
                assert.equal(carId, organizationId);
                if (options.payerError) throw options.payerError;
                return new Map(
                    (options.payers ?? []).filter(([id]) => tripIds.includes(id)),
                );
            },
        },
        "next/cache": {
            revalidatePath(path) {
                invalidations.push(path);
            },
        },
        "@/lib/db": {
            db: {
                query,
                async connect() {
                    connections += 1;
                    return {
                        query,
                        release() {
                            releases += 1;
                        },
                    };
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
        "@/lib/car-settlement": { calculateCarSettlement },
        "@/lib/car-settlement-snapshot": { getCarSettlementSnapshot },
    };

    const module = { exports: {} };
    createActionModule(
        module.exports,
        (specifier) => {
            if (!Object.hasOwn(dependencies, specifier)) {
                throw new Error(`Onverwachte import: ${specifier}`);
            }
            return dependencies[specifier];
        },
        module,
    );

    return {
        ...module.exports,
        calls,
        invalidations,
        logs,
        get connections() {
            return connections;
        },
        expectedSnapshot() {
            const result = calculateCarSettlement(
                {
                    tankDate: startpoint.tank_date,
                    odometer: startpoint.odometer,
                },
                trips.map((trip) => ({
                    driverId: trip.driver_id,
                    driverName: trip.driver_name,
                    payers: new Map(options.payers ?? []).get(trip.id),
                    startOdometer: trip.start_odometer,
                    endOdometer: trip.end_odometer,
                })),
                refuels.map((refuel) => ({
                    id: refuel.id,
                    paidBy: refuel.paid_by,
                    payerName: refuel.payer_name,
                    tankDate: refuel.tank_date,
                    odometer: refuel.odometer,
                    amountCents: refuel.amount_cents,
                    settledAt: refuel.settled_at?.toISOString() ?? null,
                })),
            );
            return getCarSettlementSnapshot(result.periods);
        },
        writes() {
            return calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
        },
        archives() {
            return calls.filter(({ sql }) =>
                sql.startsWith("INSERT INTO public.car_statement_history"),
            );
        },
        checkFinished(expectedTransaction) {
            assert.deepEqual(unexpectedQueries, []);

            if (!options.historyError && !options.updateError) {
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
                assert.equal(connections, 0);
                assert.equal(releases, 0);
                assert.deepEqual(invalidations, []);
                return;
            }

            assert.equal(connections, 1);
            assert.equal(releases, 1);
            assert.deepEqual(transactions, [
                "BEGIN",
                expectedTransaction === "commit" ? "COMMIT" : "ROLLBACK",
            ]);
            assert.deepEqual(
                invalidations,
                expectedTransaction === "commit" ? [`/auto/${organizationId}`] : [],
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

async function change(harness, action) {
    if (action === "afronden") {
        return harness.settleCarStatement(
            organizationId,
            harness.expectedSnapshot(),
        );
    }
    return harness.setCarPeriodSettled(organizationId, firstId, false);
}

for (const action of ["afronden", "heropenen"]) {
    test(`${action}: zonder sessie wordt geen databaseverbinding gemaakt`, async () => {
        const harness = createHarness({ session: null });
        const result = await change(harness, action);
        assertRejected(result, /Log eerst in/);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("none");
    });

    test(`${action}: een gewoon lid mag geen afrekening beheren`, async () => {
        const harness = createHarness({ role: "member" });
        const result = await change(harness, action);
        assertRejected(result, /Alleen eigenaars/);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });

    test(`${action}: een gebruiker zonder lidmaatschap wordt geweigerd`, async () => {
        const harness = createHarness({ role: null });
        const result = await change(harness, action);
        assertRejected(result, /Alleen eigenaars/);
        assert.deepEqual(harness.writes(), []);
        harness.checkFinished("rollback");
    });
}

test("afronden: een verouderde snapshot blokkeert alle wijzigingen", async () => {
    const harness = createHarness();
    const result = await harness.settleCarStatement(
        organizationId,
        "verouderde-snapshot",
    );
    assertRejected(result, /ondertussen veranderd/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("afronden: zonder volledige open periodes wordt niets opgeslagen", async () => {
    const harness = createHarness({ trips: [] });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assertRejected(result, /geen volledige open tankperiodes/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("afronden: beide volledige periodes worden samen met de netto betaling gearchiveerd", async () => {
    const harness = createHarness({ role: "member, owner" });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assert.deepEqual(result, { success: true });
    assert.equal(harness.archives().length, 1);
    const archive = harness.archives()[0];
    assert.deepEqual(archive.parameters.slice(0, 3), [
        organizationId,
        "alice",
        [firstId, secondId],
    ]);
    const snapshot = JSON.parse(archive.parameters[3]);
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.completedByName, "Alice");
    assert.deepEqual(
        snapshot.periods.map((period) => period.id),
        [firstId, secondId],
    );
    assert.equal(snapshot.transfers.length, 1);
    assert.equal(snapshot.transfers[0].fromUserId, "bob");
    assert.equal(snapshot.transfers[0].toUserId, "alice");
    assert.equal(snapshot.transfers[0].amountCents, 4000);
    const update = harness.writes().find(({ sql }) =>
        sql.startsWith("UPDATE public.car_refuel"),
    );
    assert.deepEqual(update.parameters, [
        organizationId,
        [firstId, secondId],
        "alice",
    ]);
    harness.checkFinished("commit");
});

test("afronden: onvolledige periodes blijven buiten het archief", async () => {
    const harness = createHarness({
        trips: [{
            driver_id: "bob",
            driver_name: "Bob",
            start_odometer: 1000,
            end_odometer: 1100,
        }],
    });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assert.deepEqual(result, { success: true });
    const archive = harness.archives()[0];
    const snapshot = JSON.parse(archive.parameters[3]);
    assert.deepEqual(archive.parameters[2], [firstId]);
    assert.deepEqual(snapshot.periods.map((period) => period.id), [firstId]);
    assert.equal(snapshot.transfers[0].amountCents, 10000);
    harness.checkFinished("commit");
});

test("afronden: een archieffout wordt gelogd en voorkomt het afsluiten van tankperiodes", async () => {
    const harness = createHarness({ historyError: true });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assertRejected(result, /niet worden bijgewerkt/);
    assert.equal(
        harness.writes().some(({ sql }) => sql.startsWith("UPDATE public.car_refuel")),
        false,
    );
    assert.equal(harness.logs.length, 1);
    assert.equal(harness.logs[0].action, "changeSettlement");
    assert.ok(harness.logs[0].error instanceof Error);
    harness.checkFinished("rollback");
});

test("afronden: een updatefout wordt gelogd en draait de archieftransactie terug", async () => {
    const harness = createHarness({ updateError: true });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assertRejected(result, /niet worden bijgewerkt/);
    assert.equal(harness.archives().length, 1);
    assert.equal(harness.logs.length, 1);
    assert.equal(harness.logs[0].action, "changeSettlement");
    assert.ok(harness.logs[0].error instanceof Error);
    harness.checkFinished("rollback");
});

test("afronden: minder gewijzigde rijen dan verwacht veroorzaakt rollback", async () => {
    const harness = createHarness({ updateCount: 1 });
    const result = await harness.settleCarStatement(
        organizationId,
        harness.expectedSnapshot(),
    );
    assertRejected(result, /ondertussen veranderd/, true);
    harness.checkFinished("rollback");
});

test("los afronden: een onvolledige periode wordt geweigerd", async () => {
    const harness = createHarness({ trips: [] });
    const result = await harness.setCarPeriodSettled(organizationId, firstId, true);
    assertRejected(result, /nog onvolledig/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("los afronden: alleen de geselecteerde periode telt mee in het archief", async () => {
    const harness = createHarness();
    const result = await harness.setCarPeriodSettled(
        organizationId,
        secondId,
        true,
    );
    assert.deepEqual(result, { success: true });
    const archive = harness.archives()[0];
    const snapshot = JSON.parse(archive.parameters[3]);
    assert.deepEqual(archive.parameters[2], [secondId]);
    assert.equal(snapshot.periods.length, 1);
    assert.equal(snapshot.periods[0].id, secondId);
    assert.equal(snapshot.periods[0].startOdometer, 1100);
    assert.equal(snapshot.transfers.length, 1);
    assert.equal(snapshot.transfers[0].fromUserId, "alice");
    assert.equal(snapshot.transfers[0].toUserId, "bob");
    assert.equal(snapshot.transfers[0].amountCents, 6000);
    harness.checkFinished("commit");
});

test("heropenen: bestaand archief wordt gemarkeerd en de tankperiode wordt geopend", async () => {
    const harness = createHarness({
        refuels: [
            firstRefuel({ settled_at: new Date("2026-01-02T12:00:00Z") }),
            secondRefuel(),
        ],
    });
    const result = await harness.setCarPeriodSettled(
        organizationId,
        firstId,
        false,
    );
    assert.deepEqual(result, { success: true });
    assert.equal(harness.archives().length, 0);
    assert.equal(harness.writes().length, 2);
    const [historyUpdate, refuelUpdate] = harness.writes();
    assert.match(historyUpdate.sql, /^UPDATE public\.car_statement_history/);
    assert.match(historyUpdate.sql, /reopened_at = clock_timestamp\(\)/);
    assert.match(historyUpdate.sql, /ANY\(period_ids\)/);
    assert.deepEqual(historyUpdate.parameters, [organizationId, firstId]);
    assert.match(refuelUpdate.sql, /^UPDATE public\.car_refuel/);
    assert.match(refuelUpdate.sql, /settled_at = NULL/);
    assert.match(refuelUpdate.sql, /settled_by = NULL/);
    assert.deepEqual(refuelUpdate.parameters, [organizationId, firstId]);
    harness.checkFinished("commit");
});

test("heropenen: een al open periode veroorzaakt geen extra schrijfacties", async () => {
    const harness = createHarness();
    const result = await harness.setCarPeriodSettled(
        organizationId,
        firstId,
        false,
    );
    assert.deepEqual(result, { success: true });
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("commit");
});

test("los afronden: een al afgesloten periode krijgt geen dubbel archief", async () => {
    const harness = createHarness({
        refuels: [
            firstRefuel({ settled_at: new Date("2026-01-02T12:00:00Z") }),
        ],
    });
    const result = await harness.setCarPeriodSettled(
        organizationId,
        firstId,
        true,
    );
    assert.deepEqual(result, { success: true });
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("commit");
});

test("periode wijzigen: een verdwenen periode vraagt om vernieuwen", async () => {
    const harness = createHarness();
    const result = await harness.setCarPeriodSettled(
        organizationId,
        unknownId,
        false,
    );
    assertRejected(result, /bestaat niet meer/, true);
    assert.deepEqual(harness.writes(), []);
    harness.checkFinished("rollback");
});

test("periode wijzigen: een ongeldige periode-id bereikt de database niet", async () => {
    const harness = createHarness();
    const result = await harness.setCarPeriodSettled(
        organizationId,
        "ongeldig",
        true,
    );
    assertRejected(result, /Ongeldige tankperiode/);
    harness.checkFinished("none");
});

test("historiek: zonder sessie worden geen gegevens opgehaald", async () => {
    const harness = createHarness({ session: null });
    const result = await harness.getCarStatementHistory(organizationId, 0);
    assertRejected(result, /Log eerst in/);
    assert.deepEqual(harness.calls, []);
    harness.checkFinished("none");
});

test("historiek: ongeldige paginanummers worden geweigerd", async () => {
    for (const page of [-1, 0.5, 1000001]) {
        const harness = createHarness();
        const result = await harness.getCarStatementHistory(organizationId, page);
        assertRejected(result, /Ongeldige pagina/);
        assert.deepEqual(harness.calls, []);
        harness.checkFinished("none");
    }
});

test("historiek: ontbrekende toegang geeft geen archiefgegevens terug", async () => {
    const harness = createHarness({
        history: { authorized: false, total: 0, items: [] },
    });
    const result = await harness.getCarStatementHistory(organizationId, 0);
    assertRejected(result, /geen toegang/);
    assert.equal(Object.hasOwn(result, "items"), false);
    harness.checkFinished("none");
});

test("historiek: een toegestane pagina krijgt de juiste offset", async () => {
    const items = [{
        id: "history-1",
        created_at: "2026-01-03T12:00:00Z",
        reopened_at: null,
        snapshot: {
            version: 1,
            completedByName: "Alice",
            periods: [],
            transfers: [],
        },
    }];
    const harness = createHarness({
        history: { authorized: true, total: 11, items },
    });
    const result = await harness.getCarStatementHistory(organizationId, 2);
    assert.deepEqual(result, { success: true, total: 11, items });
    assert.deepEqual(harness.calls[0].parameters, [organizationId, "alice", 10]);
    harness.checkFinished("none");
});

test("afronden archiveert het aandeel van een gast zonder gebruikersaccount", async () => {
    const payers = [
        { kind: "member", userId: "bob", name: "Bob" },
        { kind: "guest", guestId: "guest-1", name: "Sofie" },
    ];
    const h = createHarness({
        trips: [{
            id: "trip-1",
            driver_id: "bob",
            driver_name: "Bob",
            start_odometer: 1000,
            end_odometer: 1100,
        }],
        refuels: [firstRefuel()],
        payers: [["trip-1", payers]],
    });
    assert.deepEqual(
        await h.settleCarStatement(organizationId, h.expectedSnapshot()),
        { success: true },
    );
    const snapshot = JSON.parse(h.archives()[0].parameters[3]);
    assert.equal(snapshot.periods[0].shares.length, 2);
    assert.ok(
        snapshot.transfers.some(
            (transfer) =>
                transfer.fromUserId === "guest:guest-1" &&
                transfer.amountCents === 5000,
        ),
    );
    h.checkFinished("commit");
});