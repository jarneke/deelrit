import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function load(relativePath, dependencies = {}) {
    const url = new URL(relativePath, import.meta.url);
    const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
        fileName: fileURLToPath(url),
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    });

    const module = { exports: {} };

    compileFunction(
        compiled.outputText,
        ["exports", "require", "module"],
        { filename: fileURLToPath(url) },
    )(
        module.exports,
        (name) => {
            if (name === "server-only") return {};

            if (!Object.hasOwn(dependencies, name)) {
                throw new Error("Onverwachte import: " + name);
            }

            return dependencies[name];
        },
        module,
    );

    return module.exports;
}

const helpers = load("../src/lib/car-trip-payers.ts");
const settlement = load("../src/lib/car-settlement.ts");

const statistics = load("../src/lib/car-statistics.ts", {
    "@/lib/car-settlement": settlement,
    "@/lib/car-trip-payers": helpers,
});

const server = load("../src/lib/car-trip-payers-server.ts", {
    "@/lib/car-trip-payers": helpers,
});

const guestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherGuestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const members = [
    { userId: "alice", name: "Alice" },
    { userId: "bob", name: "Bob" },
];

const shared = [
    { kind: "member", userId: "alice", name: "Alice" },
    { kind: "member", userId: "bob", name: "Bob" },
    { kind: "guest", guestId, name: "Sofie" },
];

function source(payers = shared) {
    return {
        today: "2026-10-22",
        startpoint: {
            tankDate: "2026-10-01",
            odometer: 1000,
        },
        members,
        trips: [
            {
                id: "trip-1",
                tripDate: "2026-10-02",
                driverId: "alice",
                driverName: "Alice",
                payers,
                startOdometer: 1000,
                endOdometer: 1100,
            },
        ],
        refuels: [
            {
                id: "refuel-1",
                paidBy: "alice",
                payerName: "Alice",
                tankDate: "2026-10-03",
                odometer: 1100,
                amountCents: 10001,
            },
        ],
    };
}

function total(rows, field) {
    return rows.reduce((sum, row) => sum + row[field], 0);
}

test("betalers: aantallen, dubbele identiteiten en lege gastnamen worden geweigerd", () => {
    const invalid = [
        null,
        [],
        Array.from({ length: 6 }, (_, i) => ({
            kind: "member",
            userId: "member-" + i,
        })),
        [
            { kind: "member", userId: "alice" },
            { kind: "member", userId: "alice" },
        ],
        [
            { kind: "guest", guestId, name: "Sofie" },
            { kind: "guest", guestId, name: "Sofie" },
        ],
        [{ kind: "guest", name: "   " }],
        [{ kind: "guest", name: "a".repeat(81) }],
        [{ kind: "guest", guestId: "ongeldig", name: "Sofie" }],
        [{ kind: "member", userId: "" }],
    ];

    for (const value of invalid) {
        assert.equal(
            helpers.validateTripPayerInputs(value).success,
            false,
        );
    }
});

test("betalers: gastnamen worden opgeschoond en dezelfde naam is geen identiteit", () => {
    const result = helpers.validateTripPayerInputs([
        { kind: "guest", name: "  Sofie   Peeters  " },
        { kind: "guest", name: "Sofie Peeters" },
    ]);

    assert.equal(result.success, true);
    assert.equal(result.payers[0].name, "Sofie Peeters");
    assert.equal(result.payers.length, 2);

    assert.notEqual(
        helpers.getTripPayerId({
            kind: "guest",
            guestId,
            name: "Sofie",
        }),
        helpers.getTripPayerId({
            kind: "guest",
            guestId: otherGuestId,
            name: "Sofie",
        }),
    );
});

test("oude ritten behouden hun enige betaler", () => {
    const trip = {
        driverId: "bob",
        driverName: "Bob",
    };

    assert.deepEqual(helpers.getTripPayers(trip), [
        { kind: "member", userId: "bob", name: "Bob" },
    ]);

    assert.equal(helpers.formatTripPayers(trip), "Bob");
});

for (let count = 1; count <= 5; count += 1) {
    test(
        "afrekening en statistieken: " +
        count +
        " betalers behouden alle kilometers en centen",
        () => {
            const payers = Array.from({ length: count }, (_, index) =>
                count > 1 && index === count - 1
                    ? {
                        kind: "guest",
                        guestId,
                        name: "Sofie",
                    }
                    : {
                        kind: "member",
                        userId:
                            index === 0
                                ? "alice"
                                : "person-" + index,
                        name: "Persoon " + index,
                    },
            );

            const input = source(payers);

            const result = settlement.calculateCarSettlement(
                input.startpoint,
                input.trips,
                input.refuels,
            );

            const shares = result.periods[0].shares;

            assert.equal(shares.length, count);
            assert.equal(total(shares, "amountCents"), 10001);

            assert.ok(
                Math.abs(total(shares, "distance") - 100) < 1e-9,
            );

            assert.ok(
                Math.max(...shares.map((share) => share.amountCents)) -
                Math.min(...shares.map((share) => share.amountCents)) <=
                1,
            );

            assert.equal(total(result.balances, "balanceCents"), 0);

            const stats = statistics.calculateCarStatistics(input);

            assert.equal(stats.tripCounts.length, 1);
            assert.equal(stats.tripCounts[0].userIds.length, count);
            assert.equal(total(stats.days, "costCents"), 10001);

            assert.ok(
                Math.abs(total(stats.days, "distance") - 100) < 1e-9,
            );

            assert.ok(
                Math.abs(total(stats.days, "pricedKm") - 100) < 1e-9,
            );

            for (const share of shares) {
                const ownDays = stats.days.filter(
                    (day) => day.userId === share.userId,
                );

                assert.equal(
                    total(ownDays, "costCents"),
                    share.amountCents,
                );
            }

            const guest = stats.people.find((person) =>
                person.userId.startsWith("guest:"),
            );

            if (count > 1) {
                assert.equal(guest.name, "Sofie (gast)");
                assert.equal(guest.formerMember, false);
            }
        },
    );
}

test("één kilometer met drie betalers veroorzaakt geen BigInt- of afrondingsfout", () => {
    const input = source();

    input.trips[0].endOdometer = 1001;
    input.refuels[0].odometer = 1001;

    const result = statistics.calculateCarStatistics(input);

    assert.equal(total(result.days, "costCents"), 10001);
    assert.ok(
        Math.abs(total(result.days, "distance") - 1) < 1e-9,
    );
});

test("een gedeelde rit over twee tankperiodes behoudt beide bedragen", () => {
    const input = source();

    input.refuels = [
        {
            ...input.refuels[0],
            odometer: 1049,
        },
        {
            ...input.refuels[0],
            id: "refuel-2",
            odometer: 1100,
        },
    ];

    const result = statistics.calculateCarStatistics(input);

    assert.equal(result.tripCounts.length, 1);
    assert.equal(result.tanks.length, 2);
    assert.equal(total(result.days, "costCents"), 20002);

    assert.ok(
        Math.abs(total(result.days, "pricedKm") - 100) < 1e-9,
    );
});

test("ontbrekende of overlappende ritten krijgen geen kosten toegewezen", () => {
    for (const overlap of [false, true]) {
        const input = source();

        if (overlap) {
            input.trips.push({
                ...input.trips[0],
                id: "trip-2",
                startOdometer: 1050,
            });
        } else {
            input.trips[0].startOdometer = 1001;
        }

        const result = statistics.calculateCarStatistics(input);

        assert.equal(total(result.days, "costCents"), 0);
        assert.equal(total(result.days, "pricedKm"), 0);
        assert.ok(total(result.days, "blockedKm") > 0);

        assert.equal(
            result.tanks[0].status,
            overlap ? "overlapping-trips" : "missing-trips",
        );
    }
});

test("kosten zonder afgesloten tankperiode blijven in afwachting", () => {
    const input = source();
    input.refuels = [];

    const result = statistics.calculateCarStatistics(input);

    assert.equal(total(result.days, "costCents"), 0);
    assert.equal(total(result.days, "pricedKm"), 0);
    assert.equal(total(result.days, "blockedKm"), 0);

    assert.ok(
        Math.abs(total(result.days, "distance") - 100) < 1e-9,
    );
});

test("laden van betalers gebruikt de juiste auto en ritten", async () => {
    const calls = [];

    const client = {
        async query(sql, parameters) {
            calls.push(parameters);

            return {
                rows: [
                    {
                        trip_id: "trip-1",
                        user_id: "alice",
                        guest_id: null,
                        member_name: "Alice",
                        guest_name: null,
                    },
                    {
                        trip_id: "trip-1",
                        user_id: null,
                        guest_id: guestId,
                        member_name: null,
                        guest_name: "Sofie",
                    },
                ],
            };
        },
    };

    assert.equal(
        (await server.loadCarTripPayers(client, "car", [])).size,
        0,
    );
    assert.equal(calls.length, 0);

    const result = await server.loadCarTripPayers(
        client,
        "car",
        ["trip-1"],
    );

    assert.deepEqual(calls, [["car", ["trip-1"]]]);
    assert.deepEqual(
        result.get("trip-1"),
        [shared[0], shared[2]],
    );
});

test("een onbekend groepslid wordt geweigerd zonder schrijfactie", async () => {
    const client = {
        query() {
            throw new Error("Geen query verwacht");
        },
    };

    await assert.rejects(
        server.resolveCarTripPayers(
            client,
            "car",
            "alice",
            [{ kind: "member", userId: "outsider" }],
            members,
            [],
        ),
        /geen lid/,
    );
});

test("een voormalig lid mag op diens bestaande rit behouden blijven", async () => {
    const client = {
        query() {
            throw new Error("Geen query verwacht");
        },
    };

    const former = {
        kind: "member",
        userId: "former",
        name: "Oud lid",
    };

    const result = await server.resolveCarTripPayers(
        client,
        "car",
        "alice",
        [{ kind: "member", userId: "former" }],
        members,
        [former],
    );

    assert.deepEqual(result, [former]);
});

test("een gast uit een andere auto wordt geweigerd", async () => {
    const calls = [];

    const client = {
        async query(sql, parameters) {
            calls.push({ sql, parameters });
            return { rows: [] };
        },
    };

    await assert.rejects(
        server.resolveCarTripPayers(
            client,
            "car",
            "alice",
            [shared[2]],
            members,
            [],
        ),
        /hoort niet bij deze auto/,
    );

    assert.deepEqual(
        calls[0].parameters,
        ["car", guestId],
    );

    assert.equal(
        calls.some((call) => /INSERT|UPDATE/.test(call.sql)),
        false,
    );
});

test("een ongewijzigde gast behoudt diens identiteit", async () => {
    let calls = 0;

    const client = {
        async query() {
            calls += 1;

            return {
                rows: [{ id: guestId, name: "Sofie" }],
            };
        },
    };

    const result = await server.resolveCarTripPayers(
        client,
        "car",
        "alice",
        [shared[2]],
        members,
        [],
    );

    assert.deepEqual(result, [shared[2]]);
    assert.equal(calls, 1);
});

test("een gewijzigde gastnaam verandert geen eerdere gastgegevens", async () => {
    const calls = [];

    const client = {
        async query(sql, parameters) {
            calls.push({ sql, parameters });

            return sql.includes("INSERT")
                ? {
                    rows: [{
                        id: otherGuestId,
                        name: "Sofie Peeters",
                    }],
                }
                : {
                    rows: [{
                        id: guestId,
                        name: "Sofie",
                    }],
                };
        },
    };

    const result = await server.resolveCarTripPayers(
        client,
        "car",
        "alice",
        [{
            kind: "guest",
            guestId,
            name: "Sofie Peeters",
        }],
        members,
        [shared[2]],
    );

    assert.equal(result[0].guestId, otherGuestId);

    assert.deepEqual(
        calls[1].parameters,
        ["car", "Sofie Peeters", "alice"],
    );

    assert.equal(
        calls.some((call) => /UPDATE/.test(call.sql)),
        false,
    );
});

test("opslaan bewaart leden en gasten in dezelfde volgorde", async () => {
    const calls = [];

    const client = {
        async query(sql, parameters) {
            calls.push({ sql, parameters });

            return {
                rows: [],
                rowCount: 1,
            };
        },
    };

    await server.replaceCarTripPayers(
        client,
        "car",
        "trip-1",
        [shared[0], shared[2]],
    );

    assert.equal(calls.length, 3);

    assert.deepEqual(
        calls[0].parameters,
        ["car", "trip-1"],
    );

    assert.deepEqual(
        calls[1].parameters,
        ["trip-1", "car", 1, "alice", null],
    );

    assert.deepEqual(
        calls[2].parameters,
        ["trip-1", "car", 2, null, guestId],
    );
});

test("ongeldige betalers worden geweigerd vóór de bestaande lijst wordt verwijderd", async () => {
    const client = {
        query() {
            throw new Error("Geen query verwacht");
        },
    };

    await assert.rejects(
        server.replaceCarTripPayers(
            client,
            "car",
            "trip-1",
            [],
        ),
        /ongeldig/,
    );
});