import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { calculateCarSettlement } from "../src/lib/car-settlement.ts";
import { getCarSettlementSnapshot } from "../src/lib/car-settlement-snapshot.ts";

const moduleUrl = new URL("../src/lib/car-overview.ts", import.meta.url);
const source = await readFile(moduleUrl, "utf8");
const compiled = ts.transpileModule(source, {
    fileName: fileURLToPath(moduleUrl),
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
    },
});
const createOverviewModule = compileFunction(
    compiled.outputText,
    ["exports", "require", "module"],
    { filename: fileURLToPath(moduleUrl) },
);
const organizationId = "test-car";
const userId = "alice";

function makeTrips() {
    return [
        {
            id: "trip-1",
            driver_id: "bob",
            driver_name: "Bob",
            created_by: "alice",
            version: "2026-01-02 12:00:00+00",
            trip_date: "2026-01-02",
            ended_at: new Date("2026-01-02T12:00:00.000Z"),
            start_odometer: 1000,
            end_odometer: 1100,
            description: "Eerste rit",
        },
        {
            id: "trip-2",
            driver_id: "alice",
            driver_name: "Alice",
            created_by: "alice",
            version: "2026-01-03 12:00:00+00",
            trip_date: "2026-01-03",
            ended_at: null,
            start_odometer: 1100,
            end_odometer: 1200,
            description: "Tweede rit",
        },
    ];
}

function makeRefuels() {
    return [
        {
            id: "refuel-1",
            paid_by: "alice",
            payer_name: "Alice",
            created_by: "alice",
            version: "2026-01-02 13:00:00+00",
            tank_date: "2026-01-02",
            odometer: 1100,
            amount_cents: 10000,
            settled_at: null,
        },
        {
            id: "refuel-2",
            paid_by: "bob",
            payer_name: "Bob",
            created_by: "bob",
            version: "2026-01-03 13:00:00+00",
            tank_date: "2026-01-03",
            odometer: 1200,
            amount_cents: 6000,
            settled_at: null,
        },
    ];
}

function createHarness(options = {}) {
    const trips = options.trips ?? makeTrips();
    const refuels = options.refuels ?? makeRefuels();
    const startpoint = Object.hasOwn(options, "startpoint")
        ? options.startpoint
        : { tank_date: "2026-01-01", odometer: 1000 };
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
            if (sql.includes("FROM public.car_trip AS trip")) {
                if (options.readError) throw options.readError;
                return rowsResult(trips);
            }
            if (sql.includes("FROM public.car_refuel AS refuel")) {
                return rowsResult(refuels);
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
        "server-only": {},
        "node:crypto": { createHash },
        "@/lib/db": {
            db: {
                async connect() {
                    connections += 1;
                    if (options.connectError) throw options.connectError;
                    return client;
                },
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
    createOverviewModule(
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
        load() {
            return module.exports.loadCarOverview(organizationId, userId);
        },
        AccessError: module.exports.CarOverviewAccessError,
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

test("het overzicht bevat aantallen, gereden kilometers en de nieuwste gegevens", async () => {
    const h = createHarness();
    const overview = await h.load();
    assert.equal(overview.tripCount, 2);
    assert.equal(overview.refuelCount, 2);
    assert.equal(overview.totalDistance, 200);
    assert.deepEqual(overview.gaps, []);
    assert.deepEqual(overview.startpoint, {
        tankDate: "2026-01-01",
        odometer: 1000,
    });
    assert.deepEqual(overview.latestTrip, {
        id: "trip-2",
        driverId: "alice",
        driverName: "Alice",
        payers: undefined,
        createdBy: "alice",
        version: "2026-01-03 12:00:00+00",
        tripDate: "2026-01-03",
        endedAt: null,
        startOdometer: 1100,
        endOdometer: 1200,
        description: "Tweede rit",
    });
    assert.deepEqual(overview.latestRefuel, {
        id: "refuel-2",
        paidBy: "bob",
        payerName: "Bob",
        createdBy: "bob",
        version: "2026-01-03 13:00:00+00",
        tankDate: "2026-01-03",
        odometer: 1200,
        amountCents: 6000,
        settledAt: null,
    });
    assertCommitted(h);
});

test("lidmaatschap en gegevens worden voor de juiste auto opgevraagd", async () => {
    const h = createHarness();
    await h.load();
    assert.deepEqual(h.calls[1].parameters, [organizationId, userId]);
    for (const call of h.calls.slice(2, -1)) {
        assert.deepEqual(call.parameters, [organizationId]);
    }
    assertCommitted(h);
});

test("ontbrekende kilometers aan het begin en tussen ritten worden gevonden", async () => {
    const trips = makeTrips();
    trips[0].start_odometer = 1020;
    trips[0].end_odometer = 1080;
    trips[1].start_odometer = 1120;
    const h = createHarness({ trips });
    const overview = await h.load();
    assert.equal(overview.totalDistance, 140);
    assert.deepEqual(overview.gaps, [
        { start: 1000, end: 1020 },
        { start: 1080, end: 1120 },
    ]);
    assert.equal(overview.settlementOverview.completePeriodCount, 0);
    assert.equal(overview.settlementOverview.incompletePeriodCount, 2);
    assert.deepEqual(overview.settlementOverview.transfers, []);
    assert.equal(overview.settlementOverview.firstCompleteDate, null);
    assert.equal(overview.settlementOverview.lastCompleteDate, null);
    assert.equal(overview.statementSnapshot, "[]");
    assertCommitted(h);
});

test("een overlappende rit laat de laatst bereikte kilometerstand niet teruglopen", async () => {
    const trips = makeTrips();
    trips[0].end_odometer = 1200;
    trips[1].start_odometer = 1100;
    trips[1].end_odometer = 1150;
    trips.push({
        ...trips[1],
        id: "trip-3",
        start_odometer: 1210,
        end_odometer: 1300,
    });
    const h = createHarness({ trips, refuels: [] });
    const overview = await h.load();
    assert.deepEqual(overview.gaps, [{ start: 1200, end: 1210 }]);
    assertCommitted(h);
});

test("een lege auto heeft nul totalen en geen nieuwste rit of tankbeurt", async () => {
    const h = createHarness({ trips: [], refuels: [] });
    const overview = await h.load();
    assert.equal(overview.tripCount, 0);
    assert.equal(overview.refuelCount, 0);
    assert.equal(overview.totalDistance, 0);
    assert.equal(overview.latestTrip, null);
    assert.equal(overview.latestRefuel, null);
    assert.deepEqual(overview.gaps, []);
    assert.equal(overview.settlementOverview.openPeriodCount, 0);
    assert.deepEqual(overview.settlementOverview.transfers, []);
    assert.equal(overview.statementSnapshot, "[]");
    assertCommitted(h);
});

test("zonder startpunt is nog geen afrekening beschikbaar", async () => {
    const h = createHarness({ startpoint: null, trips: [], refuels: [] });
    const overview = await h.load();
    assert.equal(overview.startpoint, null);
    assert.equal(overview.settlement, null);
    assert.equal(overview.settlementOverview, null);
    assert.equal(overview.statementSnapshot, null);
    assertCommitted(h);
});

test("de samenvatting bevat netto betalingen zonder volledige bronlijsten", async () => {
    const h = createHarness();
    const overview = await h.load();
    const summary = overview.settlementOverview;
    assert.equal(summary.completePeriodCount, 2);
    assert.equal(summary.incompletePeriodCount, 0);
    assert.equal(summary.openPeriodCount, 2);
    assert.equal(summary.settledPeriodCount, 0);
    assert.equal(summary.firstCompleteDate, "2026-01-01");
    assert.equal(summary.lastCompleteDate, "2026-01-03");
    assert.equal(summary.revision, overview.tripHistoryRevision);
    assert.deepEqual(summary.transfers, [{
        fromUserId: "bob",
        fromName: "Bob",
        toUserId: "alice",
        toName: "Alice",
        amountCents: 4000,
        grossAmountCents: 10000,
        offsetAmountCents: 6000,
    }]);
    assert.equal(overview.settlement.transfers[0].sources.length, 1);
    assert.equal(overview.settlement.transfers[0].offsetSources.length, 1);
    assertCommitted(h);
});

test("de verwachte snapshot is de SHA-256 van de volledige financiële snapshot", async () => {
    const h = createHarness();
    const overview = await h.load();
    assert.equal(
        overview.statementSnapshot,
        getCarSettlementSnapshot(overview.settlement.periods),
    );
    assert.equal(
        overview.settlementOverview.expectedSnapshot,
        createHash("sha256").update(overview.statementSnapshot).digest("hex"),
    );
    assertCommitted(h);
});

test("gelijke gegevens leveren dezelfde revisies en financiële snapshot op", async () => {
    const first = await createHarness().load();
    const second = await createHarness().load();
    for (const key of [
        "tripHistoryRevision",
        "refuelHistoryRevision",
        "statementHistoryRevision",
        "statementSnapshot",
    ]) {
        assert.equal(first[key], second[key]);
    }
    assert.equal(
        first.settlementOverview.expectedSnapshot,
        second.settlementOverview.expectedSnapshot,
    );
});

test("een gewijzigde ritbeschrijving vernieuwt de rittenhistoriek maar niet de financiële snapshot", async () => {
    const first = await createHarness().load();
    const trips = makeTrips();
    trips[0].description = "Gewijzigde beschrijving";
    trips[0].version = "2026-02-01 12:00:00+00";
    const second = await createHarness({ trips }).load();
    assert.notEqual(first.tripHistoryRevision, second.tripHistoryRevision);
    assert.equal(first.refuelHistoryRevision, second.refuelHistoryRevision);
    assert.equal(first.statementHistoryRevision, second.statementHistoryRevision);
    assert.equal(first.statementSnapshot, second.statementSnapshot);
    assert.equal(
        first.settlementOverview.expectedSnapshot,
        second.settlementOverview.expectedSnapshot,
    );
});

test("een gewijzigd tankbedrag vernieuwt de historiek en financiële snapshot", async () => {
    const first = await createHarness().load();
    const refuels = makeRefuels();
    refuels[0].amount_cents = 11000;
    refuels[0].version = "2026-02-01 12:00:00+00";
    const second = await createHarness({ refuels }).load();
    assert.notEqual(first.refuelHistoryRevision, second.refuelHistoryRevision);
    assert.notEqual(first.tripHistoryRevision, second.tripHistoryRevision);
    assert.notEqual(first.statementHistoryRevision, second.statementHistoryRevision);
    assert.notEqual(
        first.settlementOverview.expectedSnapshot,
        second.settlementOverview.expectedSnapshot,
    );
    assert.equal(second.settlementOverview.transfers[0].amountCents, 5000);
});

test("een andere bestuurder verandert de financiële snapshot", async () => {
    const first = await createHarness().load();
    const trips = makeTrips();
    trips[0].driver_id = "alice";
    trips[0].driver_name = "Alice";
    const second = await createHarness({ trips }).load();
    assert.notEqual(first.statementSnapshot, second.statementSnapshot);
    assert.notEqual(
        first.settlementOverview.expectedSnapshot,
        second.settlementOverview.expectedSnapshot,
    );
});

test("naamswijzigingen wijzigen de weergaverevisie maar niet de financiële snapshot", async () => {
    const first = await createHarness().load();
    const trips = makeTrips();
    const refuels = makeRefuels();
    trips[0].driver_name = "Robert";
    refuels[1].payer_name = "Robert";
    const second = await createHarness({ trips, refuels }).load();
    assert.notEqual(first.tripHistoryRevision, second.tripHistoryRevision);
    assert.notEqual(first.refuelHistoryRevision, second.refuelHistoryRevision);
    assert.equal(first.statementSnapshot, second.statementSnapshot);
    assert.equal(
        first.settlementOverview.expectedSnapshot,
        second.settlementOverview.expectedSnapshot,
    );
});

test("afgerekende periodes verdwijnen uit de betaling maar behouden de volgende startgrens", async () => {
    const refuels = makeRefuels();
    refuels[0].settled_at = new Date("2026-02-01T12:00:00.000Z");
    const h = createHarness({ refuels });
    const overview = await h.load();
    const summary = overview.settlementOverview;
    assert.equal(summary.openPeriodCount, 1);
    assert.equal(summary.settledPeriodCount, 1);
    assert.equal(summary.completePeriodCount, 1);
    assert.equal(summary.firstCompleteDate, "2026-01-02");
    assert.equal(summary.lastCompleteDate, "2026-01-03");
    assert.equal(overview.settlement.periods[0].startOdometer, 1100);
    assert.equal(
        overview.settlement.settledPeriods[0].settledAt,
        "2026-02-01T12:00:00.000Z",
    );
    assert.deepEqual(
        JSON.parse(overview.statementSnapshot).map((period) => period.id),
        ["refuel-2"],
    );
    assert.deepEqual(summary.transfers, [{
        fromUserId: "alice",
        fromName: "Alice",
        toUserId: "bob",
        toName: "Bob",
        amountCents: 6000,
        grossAmountCents: 6000,
        offsetAmountCents: 0,
    }]);
    assertCommitted(h);
});

test("afrekenen vernieuwt de historie- en overzichtsrevisies", async () => {
    const first = await createHarness().load();
    const refuels = makeRefuels();
    refuels[0].settled_at = new Date("2026-02-01T12:00:00.000Z");
    const second = await createHarness({ refuels }).load();
    for (const key of [
        "tripHistoryRevision",
        "refuelHistoryRevision",
        "statementHistoryRevision",
        "statementSnapshot",
    ]) {
        assert.notEqual(first[key], second[key]);
    }
});

test("zonder lidmaatschap worden geen autogegevens geladen", async () => {
    const h = createHarness({ authorized: false });
    await assert.rejects(h.load(), (error) => {
        assert.ok(error instanceof h.AccessError);
        assert.equal(error.message, "Je hebt geen toegang tot deze auto.");
        return true;
    });
    assert.equal(h.calls.length, 3);
    assert.match(h.calls[1].sql, /FROM public\.member/);
    assert.equal(h.calls[2].sql, "ROLLBACK");
    assert.equal(h.releases, 1);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.unexpectedQueries, []);
});

test("een leesfout wordt teruggegeven na rollback en vrijgave van de verbinding", async () => {
    const error = new Error("lezen mislukt");
    const h = createHarness({ readError: error });
    await assert.rejects(h.load(), (caught) => caught === error);
    assert.equal(h.calls.at(-1).sql, "ROLLBACK");
    assert.equal(h.calls.some((call) => call.sql === "COMMIT"), false);
    assert.equal(h.releases, 1);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.unexpectedQueries, []);
});

test("een berekeningsfout veroorzaakt rollback in plaats van een gedeeltelijk overzicht", async () => {
    const refuels = makeRefuels();
    refuels[1].odometer = refuels[0].odometer;
    const h = createHarness({ refuels });
    await assert.rejects(h.load(), /verschillende kilometerstanden/);
    assert.equal(h.calls.at(-1).sql, "ROLLBACK");
    assert.equal(h.releases, 1);
    assert.deepEqual(h.unexpectedQueries, []);
});

test("een rollbackfout wordt gelogd zonder de oorspronkelijke fout te vervangen", async () => {
    const readError = new Error("lezen mislukt");
    const rollbackError = new Error("rollback mislukt");
    const h = createHarness({ readError, rollbackError });
    await assert.rejects(h.load(), (caught) => caught === readError);
    assert.equal(h.releases, 1);
    assert.deepEqual(h.logs, [{
        action: "loadCarOverview.rollback",
        error: rollbackError,
    }]);
    assert.deepEqual(h.unexpectedQueries, []);
});

test("een verbindingsfout probeert geen rollback zonder verbinding", async () => {
    const error = new Error("verbinding mislukt");
    const h = createHarness({ connectError: error });
    await assert.rejects(h.load(), (caught) => caught === error);
    assert.equal(h.connections, 1);
    assert.equal(h.releases, 0);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.logs, []);
});

test("een gedeelde rit verandert de verdeling maar niet de totale afstand", async () => {
    const payers = [
        { kind: "member", userId: "bob", name: "Bob" },
        { kind: "guest", guestId: "guest-1", name: "Sofie" },
    ];
    const h = createHarness({ payers: [["trip-1", payers]] });
    const overview = await h.load();
    assert.equal(overview.tripCount, 2);
    assert.equal(overview.totalDistance, 200);
    assert.deepEqual(
        overview.settlement.periods[0].shares
            .map((share) => share.amountCents)
            .sort((a, b) => a - b),
        [5000, 5000],
    );
    assert.ok(
        overview.settlement.transfers.some(
            (transfer) =>
                transfer.fromUserId === "guest:guest-1" &&
                transfer.amountCents === 5000,
        ),
    );
    assert.notEqual(
        overview.statementSnapshot,
        (await createHarness().load()).statementSnapshot,
    );
    assertCommitted(h);
});