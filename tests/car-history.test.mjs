import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const actionUrl = new URL("../src/actions/car-history.ts", import.meta.url);
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
const organizationId = "test-car";

function tripRows(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `trip-${index + 1}`,
        driver_id: "bob",
        driver_name: "Bob",
        created_by: "alice",
        version: "2026-01-02 12:00:00+00",
        trip_date: "2026-01-02",
        ended_at: new Date("2026-01-02T12:00:00.000Z"),
        start_odometer: 1000 + index * 100,
        end_odometer: 1100 + index * 100,
        description: `Rit ${index + 1}`,
        settled_locked: false,
    })).reverse();
}

function refuelRows(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `refuel-${index + 1}`,
        paid_by: "alice",
        payer_name: "Alice",
        created_by: "alice",
        version: "2026-01-02 12:00:00+00",
        tank_date: "2026-01-02",
        odometer: 1100 + index * 100,
        amount_cents: 10000,
        settled_at: null,
        next_tank_date: index + 1 < count ? "2026-01-02" : null,
        next_settled_at: null,
    })).reverse();
}

function createHarness(options = {}) {
    const trips = options.trips ?? tripRows(12);
    const refuels = options.refuels ?? refuelRows(6);
    const startpoint = Object.hasOwn(options, "startpoint")
        ? options.startpoint
        : { tank_date: "2026-01-01", odometer: 1000 };
    const session = Object.hasOwn(options, "session")
        ? options.session
        : { user: { id: "alice" } };
    const calls = [];
    const logs = [];
    const unexpectedQueries = [];
    let connections = 0;
    let releases = 0;

    function rowsResult(rows) {
        return { rows: structuredClone(rows), rowCount: rows.length };
    }

    const client = {
        async query(statement, parameters = []) {
            const sql = statement.replace(/\s+/g, " ").trim();
            calls.push({ sql, parameters: [...parameters] });

            if (sql === "ROLLBACK") {
                if (options.rollbackError) throw options.rollbackError;
                return rowsResult([]);
            }
            if (
                sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
                sql === "COMMIT"
            ) {
                return rowsResult([]);
            }
            if (sql.includes("FROM public.member")) {
                return rowsResult(
                    options.authorized === false ? [] : [{ id: "membership" }],
                );
            }
            if (sql.includes("FROM public.car_startpoint")) {
                return rowsResult(startpoint ? [startpoint] : []);
            }
            if (sql.startsWith("SELECT COUNT(*)")) {
                const rows = sql.includes("FROM public.car_trip")
                    ? trips
                    : refuels;
                return rowsResult([{
                    total: Object.hasOwn(options, "count")
                        ? options.count
                        : String(rows.length),
                }]);
            }
            if (sql.startsWith("WITH periods AS")) {
                if (options.pageError) throw options.pageError;
                const limit = parameters[2];
                const offset = parameters[3];
                return rowsResult(trips.slice(offset, offset + limit));
            }
            if (sql.startsWith("WITH ordered_refuels AS")) {
                if (options.pageError) throw options.pageError;
                const limit = parameters[1];
                const offset = parameters[2];
                return rowsResult(refuels.slice(offset, offset + limit));
            }

            unexpectedQueries.push(sql);
            throw new Error(`Onverwachte query: ${sql}`);
        },
        release() {
            releases += 1;
        },
    };

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
        "@/lib/db": {
            db: {
                async connect() {
                    connections += 1;
                    if (options.connectError) throw options.connectError;
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

    const module = { exports: {} };
    createActionModule(
        module.exports,
        (name) => {
            if (!Object.hasOwn(dependencies, name)) {
                throw new Error(`Onverwachte import: ${name}`);
            }
            return dependencies[name];
        },
        module,
    );

    return {
        actions: module.exports,
        calls,
        logs,
        unexpectedQueries,
        get connections() {
            return connections;
        },
        get releases() {
            return releases;
        },
    };
}

function successfulData(result) {
    assert.equal(result.success, true);
    return result.data;
}

function assertCommitted(h) {
    assert.equal(h.connections, 1);
    assert.equal(h.releases, 1);
    assert.equal(
        h.calls[0].sql,
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    assert.equal(h.calls.at(-1).sql, "COMMIT");
    assert.equal(h.calls.some((call) => call.sql === "ROLLBACK"), false);
    assert.deepEqual(h.unexpectedQueries, []);
    assert.deepEqual(h.logs, []);
}

test("ritten worden per tien geladen met de juiste databasegrenzen", async () => {
    const h = createHarness();
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 0),
    );
    assert.equal(data.total, 12);
    assert.equal(data.page, 0);
    assert.equal(data.pageSize, 10);
    assert.equal(data.items.length, 10);
    assert.equal(data.items[0].id, "trip-12");
    assert.equal(data.items.at(-1).id, "trip-3");
    const query = h.calls.find((call) => call.sql.startsWith("WITH periods AS"));
    assert.deepEqual(query.parameters, [organizationId, 1000, 10, 0]);
    assert.match(query.sql, /LIMIT \$3 OFFSET \$4/);
    assertCommitted(h);
});

test("de tweede rittenpagina bevat alleen de resterende ritten", async () => {
    const h = createHarness();
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 1),
    );
    assert.deepEqual(
        data.items.map((trip) => trip.id),
        ["trip-2", "trip-1"],
    );
    const query = h.calls.find((call) => call.sql.startsWith("WITH periods AS"));
    assert.deepEqual(query.parameters, [organizationId, 1000, 10, 10]);
    assertCommitted(h);
});

test("een te hoge rittenpagina wordt beperkt tot de laatste pagina", async () => {
    const h = createHarness();
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 999),
    );
    assert.equal(data.page, 1);
    assert.equal(data.items.length, 2);
    assertCommitted(h);
});

test("een lege rittenhistoriek blijft op pagina nul", async () => {
    const h = createHarness({ trips: [] });
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 999),
    );
    assert.deepEqual(data.items, []);
    assert.equal(data.total, 0);
    assert.equal(data.page, 0);
    assertCommitted(h);
});

test("ritvelden, eindtijd en vergrendeling worden correct doorgegeven", async () => {
    const rows = tripRows(1);
    rows[0].settled_locked = true;
    const h = createHarness({ trips: rows });
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 0),
    );
    assert.deepEqual(data.items[0], {
        id: "trip-1",
        driverId: "bob",
        driverName: "Bob",
        payers: undefined,
        createdBy: "alice",
        version: "2026-01-02 12:00:00+00",
        tripDate: "2026-01-02",
        endedAt: "2026-01-02T12:00:00.000Z",
        startOdometer: 1000,
        endOdometer: 1100,
        description: "Rit 1",
        settledLocked: true,
    });
    assertCommitted(h);
});

test("een ontbrekende riteindtijd blijft null", async () => {
    const rows = tripRows(1);
    rows[0].ended_at = null;
    const h = createHarness({ trips: rows });
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 0),
    );
    assert.equal(data.items[0].endedAt, null);
    assert.equal(data.items[0].settledLocked, false);
    assertCommitted(h);
});

test("zonder startpunt wordt geen rittenpagina opgevraagd", async () => {
    const h = createHarness({ startpoint: null, trips: [] });
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 0),
    );
    assert.deepEqual(data.items, []);
    assert.equal(
        h.calls.some((call) => call.sql.startsWith("WITH periods AS")),
        false,
    );
    assertCommitted(h);
});

test("tankbeurten worden per vijf geladen zonder vroegtijdig startpunt", async () => {
    const h = createHarness();
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 0),
    );
    assert.equal(data.total, 7);
    assert.equal(data.pageSize, 5);
    assert.deepEqual(
        data.items.map((entry) => entry.refuel.id),
        ["refuel-6", "refuel-5", "refuel-4", "refuel-3", "refuel-2"],
    );
    const query = h.calls.find(
        (call) => call.sql.startsWith("WITH ordered_refuels AS"),
    );
    assert.deepEqual(query.parameters, [organizationId, 5, 0]);
    assert.match(query.sql, /LIMIT \$2 OFFSET \$3/);
    assertCommitted(h);
});

test("het startpunt staat na de oudste tankbeurt op de laatste pagina", async () => {
    const h = createHarness();
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 1),
    );
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].refuel.id, "refuel-1");
    assert.deepEqual(data.items[1], {
        kind: "startpoint",
        startpoint: { tankDate: "2026-01-01", odometer: 1000 },
    });
    assertCommitted(h);
});

test("het startpunt krijgt een eigen pagina als de vorige pagina vol is", async () => {
    const h = createHarness({ refuels: refuelRows(5) });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 1),
    );
    assert.equal(data.total, 6);
    assert.equal(data.page, 1);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].kind, "startpoint");
    assertCommitted(h);
});

test("vier tankbeurten en het startpunt passen op dezelfde pagina", async () => {
    const h = createHarness({ refuels: refuelRows(4) });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 999),
    );
    assert.equal(data.total, 5);
    assert.equal(data.page, 0);
    assert.equal(data.items.length, 5);
    assert.equal(data.items.at(-1).kind, "startpoint");
    assertCommitted(h);
});

test("zonder echte tankbeurten wordt alleen het startpunt getoond", async () => {
    const h = createHarness({ refuels: [] });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 999),
    );
    assert.equal(data.total, 1);
    assert.equal(data.page, 0);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].kind, "startpoint");
    assertCommitted(h);
});

test("zonder startpunt wordt geen virtuele tankbeurt toegevoegd", async () => {
    const h = createHarness({ startpoint: null, refuels: [] });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 0),
    );
    assert.equal(data.total, 0);
    assert.deepEqual(data.items, []);
    assertCommitted(h);
});

test("tankbeurtvelden en een afgerekende volgende grens worden doorgegeven", async () => {
    const rows = refuelRows(1);
    rows[0].settled_at = new Date("2026-02-01T12:00:00.000Z");
    rows[0].next_tank_date = "2026-02-02";
    rows[0].next_settled_at = new Date("2026-02-03T12:00:00.000Z");
    const h = createHarness({ refuels: rows });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 0),
    );
    assert.deepEqual(data.items[0], {
        kind: "refuel",
        refuel: {
            id: "refuel-1",
            paidBy: "alice",
            payerName: "Alice",
            createdBy: "alice",
            version: "2026-01-02 12:00:00+00",
            tankDate: "2026-01-02",
            odometer: 1100,
            amountCents: 10000,
            settledAt: "2026-02-01T12:00:00.000Z",
            boundaryLocked: true,
            nextRefuel: {
                tankDate: "2026-02-02",
                settledAt: "2026-02-03T12:00:00.000Z",
            },
        },
    });
    assertCommitted(h);
});

test("een open volgende tankbeurt vergrendelt de grens niet", async () => {
    const h = createHarness({ refuels: refuelRows(2) });
    const data = successfulData(
        await h.actions.getCarRefuelHistoryPage(organizationId, 0),
    );
    const latest = data.items[0].refuel;
    const oldest = data.items[1].refuel;
    assert.equal(latest.nextRefuel, null);
    assert.equal(latest.settledAt, null);
    assert.equal(latest.boundaryLocked, false);
    assert.deepEqual(oldest.nextRefuel, {
        tankDate: "2026-01-02",
        settledAt: null,
    });
    assert.equal(oldest.boundaryLocked, false);
    assertCommitted(h);
});

test("ongeldige invoer opent geen databaseverbinding", async () => {
    for (const actionName of [
        "getCarTripHistoryPage",
        "getCarRefuelHistoryPage",
    ]) {
        const h = createHarness();
        for (const page of [-1, 0.5, NaN, Infinity, "1", 1_000_001]) {
            const result = await h.actions[actionName](organizationId, page);
            assert.equal(result.success, false);
        }
        for (const carId of ["", " ", null, "a".repeat(129)]) {
            const result = await h.actions[actionName](carId, 0);
            assert.equal(result.success, false);
        }
        assert.equal(h.connections, 0);
        assert.deepEqual(h.calls, []);
    }
});

test("zonder sessie wordt geen databaseverbinding geopend", async () => {
    for (const actionName of [
        "getCarTripHistoryPage",
        "getCarRefuelHistoryPage",
    ]) {
        const h = createHarness({ session: null });
        const result = await h.actions[actionName](organizationId, 0);
        assert.equal(result.success, false);
        assert.equal(result.error, "Log eerst in.");
        assert.equal(h.connections, 0);
    }
});

test("lidmaatschap wordt gecontroleerd voordat autogegevens geladen worden", async () => {
    for (const actionName of [
        "getCarTripHistoryPage",
        "getCarRefuelHistoryPage",
    ]) {
        const h = createHarness({ authorized: false });
        const result = await h.actions[actionName](organizationId, 0);
        assert.equal(result.success, false);
        assert.equal(result.error, "Je hebt geen toegang tot deze auto.");
        assert.equal(h.calls.length, 3);
        assert.match(h.calls[1].sql, /FROM public\.member/);
        assert.deepEqual(h.calls[1].parameters, [organizationId, "alice"]);
        assert.equal(h.calls[2].sql, "ROLLBACK");
        assert.equal(h.releases, 1);
        assert.deepEqual(h.logs, []);
        assert.deepEqual(h.unexpectedQueries, []);
    }
});

test("ongeldige tellingen worden geweigerd en teruggedraaid", async () => {
    for (const count of ["-1", "1.5", "NaN", "9007199254740992"]) {
        const h = createHarness({ count });
        const result = await h.actions.getCarTripHistoryPage(organizationId, 0);
        assert.equal(result.success, false);
        assert.equal(h.calls.at(-1).sql, "ROLLBACK");
        assert.equal(h.releases, 1);
        assert.equal(h.logs.length, 1);
        assert.equal(h.logs[0].action, "getCarTripHistoryPage");
        assert.deepEqual(h.unexpectedQueries, []);
    }
});

test("een laadfout wordt gelogd zonder interne details terug te geven", async () => {
    for (const actionName of [
        "getCarTripHistoryPage",
        "getCarRefuelHistoryPage",
    ]) {
        const error = new Error("interne databasegegevens");
        const h = createHarness({ pageError: error });
        const result = await h.actions[actionName](organizationId, 0);
        assert.equal(result.success, false);
        assert.equal(result.error.includes(error.message), false);
        assert.equal(h.calls.at(-1).sql, "ROLLBACK");
        assert.equal(h.calls.some((call) => call.sql === "COMMIT"), false);
        assert.equal(h.releases, 1);
        assert.deepEqual(h.logs, [{ action: actionName, error }]);
        assert.deepEqual(h.unexpectedQueries, []);
    }
});

test("ook een mislukte rollback wordt gelogd en de verbinding wordt vrijgegeven", async () => {
    const pageError = new Error("laden mislukt");
    const rollbackError = new Error("rollback mislukt");
    const h = createHarness({ pageError, rollbackError });
    const result = await h.actions.getCarRefuelHistoryPage(organizationId, 0);
    assert.equal(result.success, false);
    assert.equal(h.releases, 1);
    assert.deepEqual(h.logs, [
        { action: "getCarRefuelHistoryPage", error: pageError },
        { action: "getCarRefuelHistoryPage.rollback", error: rollbackError },
    ]);
    assert.deepEqual(h.unexpectedQueries, []);
});

test("een verbindingsfout probeert geen rollback op een ontbrekende verbinding", async () => {
    const error = new Error("verbinding mislukt");
    const h = createHarness({ connectError: error });
    const result = await h.actions.getCarTripHistoryPage(organizationId, 0);
    assert.equal(result.success, false);
    assert.equal(h.connections, 1);
    assert.equal(h.releases, 0);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.logs, [{ action: "getCarTripHistoryPage", error }]);
});

test("gedeelde betalers worden met de rittenpagina meegegeven", async () => {
    const payers = [
        { kind: "member", userId: "bob", name: "Bob" },
        { kind: "guest", guestId: "guest-1", name: "Sofie" },
    ];
    const h = createHarness({
        trips: tripRows(1),
        payers: [["trip-1", payers]],
    });
    const data = successfulData(
        await h.actions.getCarTripHistoryPage(organizationId, 0),
    );
    assert.deepEqual(data.items[0].payers, payers);
    assertCommitted(h);
});