import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const actionUrl = new URL(
    "../src/actions/car-settlement-view.ts",
    import.meta.url,
);

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
const expectedSnapshot = "a".repeat(64);

class CarOverviewAccessError extends Error { }

function makePeriods(count, prefix) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${index + 1}`,
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        startOdometer: 1000 + index * 100,
        endOdometer: 1100 + index * 100,
        distance: 100,
        amountCents: 10000,
        paidBy: "alice",
        payerName: "Alice",
        settledAt:
            prefix === "settled"
                ? "2026-02-01T12:00:00.000Z"
                : null,
        gaps: [],
        missingDistance: 0,
        status: "complete",
        shares: [{
            userId: "bob",
            name: "Bob",
            distance: 100,
            amountCents: 10000,
        }],
    }));
}

function makeSources(count, prefix) {
    return Array.from({ length: count }, (_, index) => ({
        periodId: `${prefix}-${index + 1}`,
        tankDate: "2026-01-02",
        startOdometer: 1000 + index * 100,
        endOdometer: 1100 + index * 100,
        distance: 100,
        amountCents: 1000,
    }));
}

function makeOverview() {
    return {
        settlement: {
            periods: makePeriods(8, "open"),
            settledPeriods: makePeriods(6, "settled"),
            transfers: [{
                fromUserId: "bob",
                fromName: "Bob",
                toUserId: "alice",
                toName: "Alice",
                amountCents: 5000,
                grossAmountCents: 7000,
                offsetAmountCents: 2000,
                sources: makeSources(7, "source"),
                offsetSources: makeSources(2, "offset"),
            }],
            balances: [],
            completePeriodCount: 8,
            incompletePeriodCount: 0,
        },
        settlementOverview: {
            expectedSnapshot,
            revision: "current-revision",
        },
        statementSnapshot: '[{"id":"financial-snapshot"}]',
    };
}

function createHarness(options = {}) {
    const overview = options.overview ?? makeOverview();
    const session = Object.hasOwn(options, "session")
        ? options.session
        : { user: { id: "alice" } };

    const overviewCalls = [];
    const settlementCalls = [];
    const logs = [];

    const dependencies = {
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
        "@/lib/car-overview": {
            CarOverviewAccessError,
            async loadCarOverview(carId, userId) {
                overviewCalls.push({ carId, userId });

                if (options.overviewError) {
                    throw options.overviewError;
                }

                return overview;
            },
        },
        "@/actions/car-settlement": {
            async settleCarStatement(carId, snapshot) {
                settlementCalls.push({ carId, snapshot });

                if (options.settlementError) {
                    throw options.settlementError;
                }

                return options.settlementResult ?? {
                    success: true,
                };
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
        overview,
        overviewCalls,
        settlementCalls,
        logs,
    };
}

function successfulData(result) {
    assert.equal(result.success, true);
    return result.data;
}

test("open periodes verschijnen met de nieuwste eerst, vijf per pagina", async () => {
    const h = createHarness();

    const first = successfulData(
        await h.actions.getCarPeriodPage(organizationId, false, 0),
    );

    const second = successfulData(
        await h.actions.getCarPeriodPage(organizationId, false, 1),
    );

    assert.deepEqual(
        first.items.map((period) => period.id),
        ["open-8", "open-7", "open-6", "open-5", "open-4"],
    );
    assert.deepEqual(
        second.items.map((period) => period.id),
        ["open-3", "open-2", "open-1"],
    );
    assert.equal(first.total, 8);
    assert.equal(first.page, 0);
    assert.equal(first.pageSize, 5);
    assert.equal(second.page, 1);
    assert.equal(first.revision, "current-revision");

    assert.deepEqual(
        h.overview.settlement.periods.map((period) => period.id),
        Array.from({ length: 8 }, (_, index) => `open-${index + 1}`),
    );
});

test("afgerekende periodes hebben een afzonderlijke paginering", async () => {
    const h = createHarness();

    const data = successfulData(
        await h.actions.getCarPeriodPage(organizationId, true, 1),
    );

    assert.equal(data.total, 6);
    assert.deepEqual(
        data.items.map((period) => period.id),
        ["settled-1"],
    );
});

test("een te hoge periodepagina wordt beperkt tot de laatste pagina", async () => {
    const h = createHarness();

    const data = successfulData(
        await h.actions.getCarPeriodPage(organizationId, false, 999),
    );

    assert.equal(data.page, 1);
    assert.equal(data.items.length, 3);
});

test("een lege periodelijst blijft op pagina nul", async () => {
    const h = createHarness();
    h.overview.settlement.periods = [];

    const data = successfulData(
        await h.actions.getCarPeriodPage(organizationId, false, 99),
    );

    assert.deepEqual(data.items, []);
    assert.equal(data.total, 0);
    assert.equal(data.page, 0);
});

test("ongeldige periodepagina's worden geweigerd voordat gegevens geladen worden", async () => {
    const h = createHarness();

    for (const page of [-1, 0.5, NaN, Infinity, "1", 1_000_001]) {
        const result = await h.actions.getCarPeriodPage(
            organizationId,
            false,
            page,
        );

        assert.equal(result.success, false);
    }

    const result = await h.actions.getCarPeriodPage(
        organizationId,
        "false",
        0,
    );

    assert.equal(result.success, false);
    assert.equal(h.overviewCalls.length, 0);
});

test("ongeldige auto-identificaties laden geen overzicht", async () => {
    const h = createHarness();

    for (const carId of ["", " ", null, "a".repeat(129)]) {
        const result = await h.actions.getCarPeriodPage(
            carId,
            false,
            0,
        );

        assert.equal(result.success, false);
    }

    assert.equal(h.overviewCalls.length, 0);
});

test("zonder sessie wordt geen overzicht geladen", async () => {
    const h = createHarness({ session: null });

    const result = await h.actions.getCarPeriodPage(
        organizationId,
        false,
        0,
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "Log eerst in.");
    assert.equal(h.overviewCalls.length, 0);
});

test("de ingelogde gebruiker wordt aan de toegangscontrole doorgegeven", async () => {
    const h = createHarness({
        session: { user: { id: "bob" } },
    });

    await h.actions.getCarPeriodPage(organizationId, false, 0);

    assert.deepEqual(h.overviewCalls, [{
        carId: organizationId,
        userId: "bob",
    }]);
});

test("een geweigerde toegang geeft de domeinfout terug zonder foutlog", async () => {
    const h = createHarness({
        overviewError: new CarOverviewAccessError(
            "Je hebt geen toegang tot deze auto.",
        ),
    });

    const result = await h.actions.getCarPeriodPage(
        organizationId,
        false,
        0,
    );

    assert.equal(result.success, false);
    assert.equal(result.error, "Je hebt geen toegang tot deze auto.");
    assert.equal(h.logs.length, 0);
});

test("een onverwachte laadfout wordt gelogd en niet aan de gebruiker onthuld", async () => {
    const error = new Error("interne databasegegevens");
    const h = createHarness({ overviewError: error });

    const result = await h.actions.getCarPeriodPage(
        organizationId,
        false,
        0,
    );

    assert.equal(result.success, false);
    assert.equal(result.error.includes(error.message), false);
    assert.deepEqual(h.logs, [{
        action: "getCarPeriodPage",
        error,
    }]);
});

test("zonder startpunt vraagt de actie om het overzicht te vernieuwen", async () => {
    const h = createHarness();
    h.overview.settlement = null;
    h.overview.settlementOverview = null;

    const result = await h.actions.getCarPeriodPage(
        organizationId,
        false,
        0,
    );

    assert.equal(result.success, false);
    assert.equal(result.refreshRequired, true);
});

test("betalingsdetails pagineren bijdragen en verrekeningen zonder bedragen te wijzigen", async () => {
    const h = createHarness();
    const before = structuredClone(h.overview);

    const first = successfulData(
        await h.actions.getCarTransferPage(
            organizationId,
            "bob",
            "alice",
            0,
        ),
    );

    const second = successfulData(
        await h.actions.getCarTransferPage(
            organizationId,
            "bob",
            "alice",
            1,
        ),
    );

    assert.equal(first.transfer.sources.length, 5);
    assert.equal(first.transfer.offsetSources.length, 2);
    assert.deepEqual(
        second.transfer.sources.map((entry) => entry.periodId),
        ["source-6", "source-7"],
    );
    assert.deepEqual(second.transfer.offsetSources, []);
    assert.equal(second.sourceTotal, 7);
    assert.equal(second.offsetSourceTotal, 2);
    assert.equal(second.transfer.amountCents, 5000);
    assert.equal(second.transfer.grossAmountCents, 7000);
    assert.equal(second.transfer.offsetAmountCents, 2000);
    assert.equal(second.revision, "current-revision");
    assert.deepEqual(h.overview, before);
});

test("de langste bijdragenlijst bepaalt de laatste betalingspagina", async () => {
    const h = createHarness();
    const transfer = h.overview.settlement.transfers[0];
    transfer.sources = makeSources(2, "source");
    transfer.offsetSources = makeSources(8, "offset");

    const data = successfulData(
        await h.actions.getCarTransferPage(
            organizationId,
            "bob",
            "alice",
            999,
        ),
    );

    assert.equal(data.page, 1);
    assert.deepEqual(data.transfer.sources, []);
    assert.deepEqual(
        data.transfer.offsetSources.map((entry) => entry.periodId),
        ["offset-6", "offset-7", "offset-8"],
    );
});

test("een verdwenen betaling of omgekeerde betaalrichting vereist vernieuwen", async () => {
    const h = createHarness();

    for (const [from, to] of [
        ["alice", "bob"],
        ["unknown", "alice"],
    ]) {
        const result = await h.actions.getCarTransferPage(
            organizationId,
            from,
            to,
            0,
        );

        assert.equal(result.success, false);
        assert.equal(result.refreshRequired, true);
    }
});

test("ongeldige betalingsparameters laden geen overzicht", async () => {
    const h = createHarness();

    for (const [from, to, page] of [
        ["", "alice", 0],
        ["bob", " ", 0],
        ["a".repeat(129), "alice", 0],
        ["bob", "alice", -1],
        ["bob", "alice", 0.5],
        ["bob", "alice", 1_000_001],
    ]) {
        const result = await h.actions.getCarTransferPage(
            organizationId,
            from,
            to,
            page,
        );

        assert.equal(result.success, false);
    }

    assert.equal(h.overviewCalls.length, 0);
});

test("een ongeldig snapshotformaat start geen afrekening", async () => {
    const h = createHarness();

    for (const snapshot of [
        null,
        "",
        "a".repeat(63),
        "a".repeat(65),
        "g".repeat(64),
        "A".repeat(64),
    ]) {
        const result = await h.actions.finishCarStatement(
            organizationId,
            snapshot,
        );

        assert.equal(result.success, false);
        assert.equal(result.refreshRequired, true);
    }

    assert.equal(h.overviewCalls.length, 0);
    assert.equal(h.settlementCalls.length, 0);
});

test("een gewijzigd financieel overzicht blokkeert de afrekening", async () => {
    const h = createHarness();

    const result = await h.actions.finishCarStatement(
        organizationId,
        "b".repeat(64),
    );

    assert.equal(result.success, false);
    assert.equal(result.refreshRequired, true);
    assert.equal(h.settlementCalls.length, 0);
});

test("een ontbrekende volledige snapshot blokkeert de afrekening", async () => {
    const h = createHarness();
    h.overview.statementSnapshot = null;

    const result = await h.actions.finishCarStatement(
        organizationId,
        expectedSnapshot,
    );

    assert.equal(result.success, false);
    assert.equal(result.refreshRequired, true);
    assert.equal(h.settlementCalls.length, 0);
});

test("een geldige afrekening geeft de volledige snapshot door aan de schrijfactie", async () => {
    const h = createHarness();

    const result = await h.actions.finishCarStatement(
        organizationId,
        expectedSnapshot,
    );

    assert.deepEqual(result, {
        success: true,
        data: null,
    });
    assert.deepEqual(h.settlementCalls, [{
        carId: organizationId,
        snapshot: h.overview.statementSnapshot,
    }]);
});

test("een weigering door de schrijfactie wordt behouden", async () => {
    const rejection = {
        success: false,
        error: "De afrekening is ondertussen gewijzigd.",
        refreshRequired: true,
    };
    const h = createHarness({
        settlementResult: rejection,
    });

    const result = await h.actions.finishCarStatement(
        organizationId,
        expectedSnapshot,
    );

    assert.deepEqual(result, rejection);
    assert.equal(h.settlementCalls.length, 1);
});

test("een onverwachte schrijffout wordt gelogd en veilig teruggegeven", async () => {
    const error = new Error("interne transactiefout");
    const h = createHarness({ settlementError: error });

    const result = await h.actions.finishCarStatement(
        organizationId,
        expectedSnapshot,
    );

    assert.equal(result.success, false);
    assert.equal(result.error.includes(error.message), false);
    assert.deepEqual(h.logs, [{
        action: "finishCarStatement",
        error,
    }]);
});