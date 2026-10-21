import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCarSettlement } from "../src/lib/car-settlement.ts";
import { getCarSettlementSnapshot } from "../src/lib/car-settlement-snapshot.ts";

const startpoint = {
    tankDate: "2026-01-01",
    odometer: 1000,
};

const names = {
    alice: "Alice",
    bob: "Bob",
    charlie: "Charlie",
};

function trip(driverId, startOdometer, endOdometer) {
    return {
        driverId,
        driverName: names[driverId],
        startOdometer,
        endOdometer,
    };
}

function refuel(overrides = {}) {
    return {
        id: "fuel-1",
        paidBy: "alice",
        payerName: "Alice",
        tankDate: "2026-01-02",
        odometer: 1100,
        amountCents: 10000,
        settledAt: null,
        ...overrides,
    };
}

function sharesByDriver(period) {
    return Object.fromEntries(
        period.shares.map((share) => [
            share.userId,
            {
                distance: share.distance,
                amountCents: share.amountCents,
            },
        ]),
    );
}

function balancesByUser(settlement) {
    return Object.fromEntries(
        settlement.balances.map((balance) => [
            balance.userId,
            {
                paidCents: balance.paidCents,
                shareCents: balance.shareCents,
                balanceCents: balance.balanceCents,
            },
        ]),
    );
}

function completePeriod() {
    return calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1060),
            trip("bob", 1060, 1100),
        ],
        [refuel()],
    ).periods[0];
}

test("zonder tankbeurten ontstaat nog geen afrekening", () => {
    const result = calculateCarSettlement(
        startpoint,
        [trip("bob", 1000, 1100)],
        [],
    );

    assert.deepEqual(result, {
        periods: [],
        settledPeriods: [],
        balances: [],
        transfers: [],
        completePeriodCount: 0,
        incompletePeriodCount: 0,
    });
});

test("kosten worden volgens gereden kilometers verdeeld", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1060),
            trip("bob", 1060, 1100),
        ],
        [refuel()],
    );

    assert.equal(result.completePeriodCount, 1);
    assert.equal(result.incompletePeriodCount, 0);

    assert.deepEqual(sharesByDriver(result.periods[0]), {
        alice: { distance: 60, amountCents: 6000 },
        bob: { distance: 40, amountCents: 4000 },
    });

    assert.deepEqual(balancesByUser(result), {
        alice: {
            paidCents: 10000,
            shareCents: 6000,
            balanceCents: 4000,
        },
        bob: {
            paidCents: 0,
            shareCents: 4000,
            balanceCents: -4000,
        },
    });

    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromUserId, "bob");
    assert.equal(result.transfers[0].toUserId, "alice");
    assert.equal(result.transfers[0].amountCents, 4000);
});

test("de betaler hoeft zijn eigen aandeel niet aan zichzelf te betalen", () => {
    const result = calculateCarSettlement(
        startpoint,
        [trip("alice", 1000, 1100)],
        [refuel()],
    );

    assert.deepEqual(result.transfers, []);

    assert.deepEqual(balancesByUser(result), {
        alice: {
            paidCents: 10000,
            shareCents: 10000,
            balanceCents: 0,
        },
    });
});

test("een betaler zonder gereden kilometers krijgt de volledige kosten terug", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1060),
            trip("bob", 1060, 1100),
        ],
        [
            refuel({
                paidBy: "charlie",
                payerName: "Charlie",
            }),
        ],
    );

    assert.deepEqual(
        result.transfers.map((transfer) => ({
            from: transfer.fromUserId,
            to: transfer.toUserId,
            amount: transfer.amountCents,
        })),
        [
            { from: "alice", to: "charlie", amount: 6000 },
            { from: "bob", to: "charlie", amount: 4000 },
        ],
    );

    assert.equal(
        balancesByUser(result).charlie.balanceCents,
        10000,
    );
});

test("centafronding behoudt het totaal en verdeelt gelijke restanten stabiel", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("bob", 1000, 1001),
            trip("charlie", 1001, 1002),
            trip("alice", 1002, 1003),
        ],
        [
            refuel({
                odometer: 1003,
                amountCents: 100,
            }),
        ],
    );

    assert.deepEqual(sharesByDriver(result.periods[0]), {
        alice: { distance: 1, amountCents: 34 },
        bob: { distance: 1, amountCents: 33 },
        charlie: { distance: 1, amountCents: 33 },
    });

    assert.equal(
        result.periods[0].shares.reduce(
            (total, share) => total + share.amountCents,
            0,
        ),
        100,
    );
});

test("ook grote bedragen worden exact op gehele centen verdeeld", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1007),
            trip("bob", 1007, 1010),
        ],
        [
            refuel({
                odometer: 1010,
                amountCents: 2147483647,
            }),
        ],
    );

    assert.deepEqual(sharesByDriver(result.periods[0]), {
        alice: { distance: 7, amountCents: 1503238553 },
        bob: { distance: 3, amountCents: 644245094 },
    });

    assert.equal(
        result.periods[0].shares.reduce(
            (total, share) => total + share.amountCents,
            0,
        ),
        2147483647,
    );
});

test("ontbrekende kilometers aan begin, midden en einde blokkeren verdeling", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1010, 1030),
            trip("bob", 1040, 1080),
        ],
        [refuel()],
    );

    const period = result.periods[0];

    assert.equal(period.status, "missing-trips");
    assert.equal(period.missingDistance, 40);

    assert.deepEqual(period.gaps, [
        { start: 1000, end: 1010 },
        { start: 1030, end: 1040 },
        { start: 1080, end: 1100 },
    ]);

    assert.deepEqual(period.shares, []);
    assert.deepEqual(result.balances, []);
    assert.deepEqual(result.transfers, []);
    assert.equal(result.incompletePeriodCount, 1);
});

test("een tankperiode zonder ritten blijft volledig open", () => {
    const result = calculateCarSettlement(
        startpoint,
        [],
        [refuel()],
    );

    assert.equal(result.periods[0].status, "missing-trips");
    assert.equal(result.periods[0].missingDistance, 100);

    assert.deepEqual(result.periods[0].gaps, [
        { start: 1000, end: 1100 },
    ]);

    assert.deepEqual(result.transfers, []);
});

test("overlappende ritten blokkeren de verdeling van de tankperiode", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1070),
            trip("bob", 1060, 1100),
        ],
        [refuel()],
    );

    assert.equal(result.periods[0].status, "overlapping-trips");
    assert.deepEqual(result.periods[0].shares, []);
    assert.deepEqual(result.balances, []);
    assert.deepEqual(result.transfers, []);
});

test("een rit over een tankgrens wordt over beide periodes verdeeld", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1150),
            trip("bob", 1150, 1200),
        ],
        [
            refuel(),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                amountCents: 20000,
            }),
        ],
    );

    assert.equal(result.completePeriodCount, 2);

    assert.deepEqual(sharesByDriver(result.periods[0]), {
        alice: { distance: 100, amountCents: 10000 },
    });

    assert.deepEqual(sharesByDriver(result.periods[1]), {
        alice: { distance: 50, amountCents: 10000 },
        bob: { distance: 50, amountCents: 10000 },
    });

    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromUserId, "bob");
    assert.equal(result.transfers[0].amountCents, 10000);
    assert.equal(result.transfers[0].sources[0].periodId, "fuel-2");
});

test("kilometers na de laatste volle tank krijgen nog geen kosten", () => {
    const result = calculateCarSettlement(
        startpoint,
        [trip("bob", 1000, 1200)],
        [refuel()],
    );

    assert.deepEqual(sharesByDriver(result.periods[0]), {
        bob: { distance: 100, amountCents: 10000 },
    });

    assert.equal(result.transfers[0].amountCents, 10000);
    assert.equal(result.transfers[0].sources[0].distance, 100);
});

test("afgerekende periodes tellen niet mee maar behouden de volgende startgrens", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("bob", 1000, 1100),
            trip("alice", 1100, 1200),
        ],
        [
            refuel({
                settledAt: "2026-01-02T12:00:00.000Z",
            }),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                amountCents: 20000,
                paidBy: "bob",
                payerName: "Bob",
            }),
        ],
    );

    assert.equal(result.settledPeriods.length, 1);
    assert.equal(result.periods.length, 1);
    assert.equal(result.completePeriodCount, 1);

    assert.equal(result.periods[0].startOdometer, 1100);
    assert.equal(result.periods[0].startDate, "2026-01-02");

    assert.deepEqual(balancesByUser(result), {
        alice: {
            paidCents: 0,
            shareCents: 20000,
            balanceCents: -20000,
        },
        bob: {
            paidCents: 20000,
            shareCents: 0,
            balanceCents: 20000,
        },
    });

    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].fromUserId, "alice");
    assert.equal(result.transfers[0].toUserId, "bob");
    assert.equal(result.transfers[0].amountCents, 20000);
});

test("een onvolledige periode blokkeert geen andere volledige periode", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("alice", 1000, 1050),
            trip("bob", 1100, 1200),
        ],
        [
            refuel(),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                amountCents: 20000,
            }),
        ],
    );

    assert.equal(result.incompletePeriodCount, 1);
    assert.equal(result.completePeriodCount, 1);
    assert.equal(result.transfers.length, 1);
    assert.equal(result.transfers[0].amountCents, 20000);

    assert.deepEqual(
        result.transfers[0].sources.map((source) => source.periodId),
        ["fuel-2"],
    );
});

test("wederzijdse schulden worden tussen dezelfde twee personen verrekend", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("bob", 1000, 1100),
            trip("alice", 1100, 1200),
        ],
        [
            refuel(),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                amountCents: 6000,
                paidBy: "bob",
                payerName: "Bob",
            }),
        ],
    );

    assert.equal(result.transfers.length, 1);

    const transfer = result.transfers[0];

    assert.equal(transfer.fromUserId, "bob");
    assert.equal(transfer.toUserId, "alice");
    assert.equal(transfer.amountCents, 4000);
    assert.equal(transfer.grossAmountCents, 10000);
    assert.equal(transfer.offsetAmountCents, 6000);

    assert.deepEqual(
        transfer.sources.map((source) => source.periodId),
        ["fuel-1"],
    );

    assert.deepEqual(
        transfer.offsetSources.map((source) => source.periodId),
        ["fuel-2"],
    );
});

test("gelijke wederzijdse schulden vereisen geen betaling meer", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("bob", 1000, 1100),
            trip("alice", 1100, 1200),
        ],
        [
            refuel(),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                paidBy: "bob",
                payerName: "Bob",
            }),
        ],
    );

    assert.deepEqual(result.transfers, []);

    for (const balance of result.balances) {
        assert.equal(balance.balanceCents, 0);
    }
});

test("schulden tussen drie personen worden niet via een derde persoon weggestreept", () => {
    const result = calculateCarSettlement(
        startpoint,
        [
            trip("bob", 1000, 1100),
            trip("charlie", 1100, 1200),
            trip("alice", 1200, 1300),
        ],
        [
            refuel(),
            refuel({
                id: "fuel-2",
                tankDate: "2026-01-03",
                odometer: 1200,
                paidBy: "bob",
                payerName: "Bob",
            }),
            refuel({
                id: "fuel-3",
                tankDate: "2026-01-04",
                odometer: 1300,
                paidBy: "charlie",
                payerName: "Charlie",
            }),
        ],
    );

    assert.deepEqual(
        result.transfers
            .map(
                (transfer) =>
                    `${transfer.fromUserId}->${transfer.toUserId}:${transfer.amountCents}`,
            )
            .sort(),
        [
            "alice->charlie:10000",
            "bob->alice:10000",
            "charlie->bob:10000",
        ],
    );

    for (const balance of result.balances) {
        assert.equal(balance.balanceCents, 0);
    }
});

test("invoervolgorde verandert de uitkomst niet en de invoer blijft intact", () => {
    const trips = [
        trip("bob", 1150, 1200),
        trip("alice", 1000, 1150),
    ];

    const refuels = [
        refuel({
            id: "fuel-2",
            tankDate: "2026-01-03",
            odometer: 1200,
            amountCents: 20000,
        }),
        refuel(),
    ];

    const originalTrips = structuredClone(trips);
    const originalRefuels = structuredClone(refuels);

    const result = calculateCarSettlement(startpoint, trips, refuels);

    const reordered = calculateCarSettlement(
        startpoint,
        [...trips].reverse(),
        [...refuels].reverse(),
    );

    assert.deepEqual(result, reordered);
    assert.deepEqual(trips, originalTrips);
    assert.deepEqual(refuels, originalRefuels);
});

test("tankbeurten op of onder het startpunt worden geweigerd", () => {
    for (const odometer of [999, 1000]) {
        assert.throws(
            () =>
                calculateCarSettlement(
                    startpoint,
                    [],
                    [refuel({ odometer })],
                ),
            /verschillende kilometerstanden boven het startpunt/,
        );
    }
});

test("twee tankbeurten op dezelfde kilometerstand worden geweigerd", () => {
    assert.throws(
        () =>
            calculateCarSettlement(
                startpoint,
                [trip("alice", 1000, 1100)],
                [
                    refuel(),
                    refuel({ id: "fuel-2" }),
                ],
            ),
        /verschillende kilometerstanden boven het startpunt/,
    );
});

test("de snapshot bevat alleen volledige openstaande periodes", () => {
    const period = completePeriod();

    const settled = {
        ...structuredClone(period),
        id: "settled",
        settledAt: "2026-01-02T12:00:00.000Z",
    };

    const incomplete = {
        ...structuredClone(period),
        id: "incomplete",
        status: "missing-trips",
        missingDistance: 10,
        shares: [],
    };

    assert.equal(
        getCarSettlementSnapshot([incomplete, settled, period]),
        getCarSettlementSnapshot([period]),
    );
});

test("de snapshot blijft gelijk bij een andere volgorde van periodes en aandelen", () => {
    const first = completePeriod();

    const second = {
        ...structuredClone(first),
        id: "fuel-2",
        startDate: "2026-01-02",
        endDate: "2026-01-03",
        startOdometer: 1100,
        endOdometer: 1200,
    };

    const original = structuredClone([first, second]);

    const reordered = [second, first].map((period) => ({
        ...period,
        shares: [...period.shares].reverse(),
    }));

    assert.equal(
        getCarSettlementSnapshot(reordered),
        getCarSettlementSnapshot([first, second]),
    );

    assert.deepEqual([first, second], original);
});

test("financieel relevante wijzigingen veranderen de snapshot", () => {
    const original = completePeriod();
    const originalSnapshot = getCarSettlementSnapshot([original]);

    const changes = [
        ["periode-id", (period) => {
            period.id = "other-period";
        }],
        ["begindatum", (period) => {
            period.startDate = "2025-12-31";
        }],
        ["einddatum", (period) => {
            period.endDate = "2026-01-03";
        }],
        ["beginkilometers", (period) => {
            period.startOdometer += 1;
        }],
        ["eindkilometers", (period) => {
            period.endOdometer += 1;
        }],
        ["tankbedrag", (period) => {
            period.amountCents += 1;
        }],
        ["betaler", (period) => {
            period.paidBy = "charlie";
        }],
        ["bestuurder", (period) => {
            period.shares[0].userId = "charlie";
        }],
        ["gereden afstand", (period) => {
            period.shares[0].distance += 1;
        }],
        ["aandeel in centen", (period) => {
            period.shares[0].amountCents += 1;
        }],
    ];

    for (const [label, change] of changes) {
        const changed = structuredClone(original);
        change(changed);

        assert.notEqual(
            getCarSettlementSnapshot([changed]),
            originalSnapshot,
            `Wijziging aan ${label} moet de snapshot veranderen`,
        );
    }
});

test("naamswijzigingen veranderen de financiële snapshot niet", () => {
    const original = completePeriod();
    const renamed = structuredClone(original);

    renamed.payerName = "Nieuwe naam";

    for (const share of renamed.shares) {
        share.name = `Nieuwe naam voor ${share.userId}`;
    }

    assert.equal(
        getCarSettlementSnapshot([renamed]),
        getCarSettlementSnapshot([original]),
    );
});