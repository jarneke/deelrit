"use client";

import { useId, useState, type ReactNode } from "react";
import type {
  StatisticsData,
  StatisticsDay,
  StatisticsPerson,
} from "@/lib/car-statistics";
import styles from "./car-statistics.module.css";

const numbers = new Intl.NumberFormat("nl-BE", {
  maximumFractionDigits: 1,
});

const euros = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

const weekdays = [
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
  "Zondag",
];

type NumericField = Exclude<keyof StatisticsDay, "date" | "userId">;

type ChartRow = {
  key: string;
  label: string;
  values: number[];
};

type Measure = "distance" | "costCents";

function sum(rows: StatisticsDay[], field: NumericField) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function money(cents: number) {
  return euros.format(cents / 100);
}

function km(value: number) {
  return numbers.format(value) + " km";
}

function shift(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monday(value: string) {
  return shift(value, -((new Date(value + "T12:00:00Z").getUTCDay() + 6) % 7));
}

function weekday(value: string) {
  return (new Date(value + "T12:00:00Z").getUTCDay() + 6) % 7;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value + "-01T12:00:00Z"));
}

function series(index: number) {
  return styles["series" + (index % 8)];
}

function Card({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className={styles.card}>
      <span className={styles.muted}>{label}</span>
      <strong className={styles.value}>{value}</strong>
      <span className={styles.small}>{note}</span>
    </div>
  );
}

function Bars({
  rows,
  people,
  format,
  label,
  onSelect,
}: {
  rows: ChartRow[];
  people?: StatisticsPerson[];
  format: (value: number) => string;
  label: string;
  onSelect?: (row: ChartRow) => void;
}) {
  const max = Math.max(
    1,
    ...rows.map((row) => row.values.reduce((a, b) => a + b, 0)),
  );

  return (
    <div className={styles.chart} role="group" aria-label={label}>
      {people && (
        <div className={styles.legend}>
          {people.map((person, index) => (
            <span key={person.userId}>
              <i className={styles.dot + " " + series(index)} />
              {person.name}
            </span>
          ))}
        </div>
      )}

      <div className={styles.axis}>
        <span>0</span>
        <span>{format(max)}</span>
      </div>

      {rows.map((row) => {
        const total = row.values.reduce((a, b) => a + b, 0);
        let offset = 0;

        const content = (
          <>
            <span className={styles.barLabel}>{row.label}</span>

            <svg width="100%" height="25" aria-hidden="true">
              <rect
                width="100%"
                height="12"
                y="6"
                rx="4"
                className={styles.track}
              />

              {row.values.map((value, index) => {
                const start = offset;
                offset += value;

                return value > 0 ? (
                  <rect
                    key={index}
                    x={(start / max) * 100 + "%"}
                    y="6"
                    width={(value / max) * 100 + "%"}
                    height="12"
                    className={series(index)}
                  />
                ) : null;
              })}
            </svg>

            <span className={styles.barValue}>{format(total)}</span>
          </>
        );

        return onSelect ? (
          <button
            key={row.key}
            type="button"
            className={styles.barButton}
            aria-label={
              row.label + ": " + format(total) + ". Bekijk verdeling."
            }
            onClick={() => onSelect(row)}
          >
            {content}
          </button>
        ) : (
          <div key={row.key} className={styles.barRow}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      {note && <p className={styles.small}>{note}</p>}
      {children}
    </section>
  );
}

export default function CarStatistics({ data }: { data: StatisticsData }) {
  const id = useId();

  const [period, setPeriod] = useState(30);
  const [driver, setDriver] = useState("");
  const [measure, setMeasure] = useState<Measure>("distance");
  const [estimateKm, setEstimateKm] = useState("100");
  const [selected, setSelected] = useState<ChartRow | null>(null);
  const [tankPage, setTankPage] = useState(0);

  const from = shift(data.today, -(period - 1));
  const previousFrom = shift(from, -period);

  const all = data.days.filter(
    (row) => row.date >= from && row.date <= data.today,
  );

  const matchesDriver = (row: StatisticsDay) =>
    !driver || row.userId === driver;

  const rows = all.filter(matchesDriver);

  const previous = data.days.filter(
    (row) => row.date >= previousFrom && row.date < from && matchesDriver(row),
  );

  const distance = sum(rows, "distance");
  const pricedKm = sum(rows, "pricedKm");
  const blockedKm = sum(rows, "blockedKm");
  const pendingKm = Math.max(0, distance - pricedKm - blockedKm);
  const cost = sum(rows, "costCents");
  const trips = sum(rows, "trips");
  const rate = pricedKm > 0 ? cost / pricedKm : null;
  const previousKm = sum(previous, "distance");

  const usageFrom =
    data.startDate === null
      ? null
      : data.startDate > from
        ? data.startDate
        : from;

  const usageDays =
    usageFrom === null || usageFrom > data.today
      ? 0
      : Math.round(
          (new Date(data.today + "T12:00:00Z").getTime() -
            new Date(usageFrom + "T12:00:00Z").getTime()) /
            86400000,
        ) + 1;

  const usageRows =
    usageFrom === null ? [] : rows.filter((row) => row.date >= usageFrom);

  const monthlyKm =
    usageDays > 0 ? (sum(usageRows, "distance") / usageDays) * 30 : null;

  const canEstimateMonth =
    rate !== null && monthlyKm !== null && sum(usageRows, "trips") > 0;

  const completeComparison =
    data.startDate !== null && data.startDate <= previousFrom;

  const comparison = !completeComparison
    ? "Nog geen volledige vergelijkingsperiode"
    : previousKm === 0
      ? "Vorige periode: 0 km"
      : (distance - previousKm >= 0 ? "+" : "") +
        numbers.format(((distance - previousKm) / previousKm) * 100) +
        "% t.o.v. vorige " +
        period +
        " dagen";

  function resetSelection() {
    setSelected(null);
    setTankPage(0);
  }

  const keys: string[] = [];

  if (period <= 90) {
    for (
      let value = monday(from);
      value <= data.today;
      value = shift(value, 7)
    ) {
      keys.push(value);
    }
  } else {
    const date = new Date(from.slice(0, 7) + "-01T12:00:00Z");

    while (date.toISOString().slice(0, 10) <= data.today) {
      keys.push(date.toISOString().slice(0, 7));
      date.setUTCMonth(date.getUTCMonth() + 1);
    }
  }

  const chartRows = keys.map((key) => ({
    key,
    label:
      period <= 90
        ? dateLabel(key).replace(" " + key.slice(0, 4), "")
        : monthLabel(key),
    values: data.people.map((person) =>
      sum(
        rows.filter(
          (row) =>
            row.userId === person.userId &&
            (period <= 90
              ? monday(row.date) === key
              : row.date.slice(0, 7) === key),
        ),
        measure,
      ),
    ),
  }));

  const monthKeys = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(data.today.slice(0, 7) + "-01T12:00:00Z");
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    return date.toISOString().slice(0, 7);
  });

  const months = monthKeys.map((key) => ({
    key,
    label: monthLabel(key),
    values: data.people.map((person) =>
      sum(
        data.days.filter(
          (row) =>
            row.date.slice(0, 7) === key &&
            row.userId === person.userId &&
            matchesDriver(row),
        ),
        measure,
      ),
    ),
  }));

  const dayRows = weekdays.map((label, index) => {
    let occurrences = 0;

    for (let date = from; date <= data.today; date = shift(date, 1)) {
      if (weekday(date) === index) occurrences += 1;
    }

    return {
      key: label,
      label,
      values: [
        sum(
          rows.filter((row) => weekday(row.date) === index),
          "distance",
        ) / Math.max(1, occurrences),
      ],
    };
  });

  const selectedTanks = data.tanks
    .filter((tank) => tank.endDate >= from && tank.endDate <= data.today)
    .sort(
      (a, b) => b.endDate.localeCompare(a.endDate) || b.id.localeCompare(a.id),
    );

  const pages = Math.max(1, Math.ceil(selectedTanks.length / 5));
  const currentTankPage = Math.min(tankPage, pages - 1);
  const valueFormat = measure === "distance" ? km : money;

  const ownRate = (personRows: StatisticsDay[]) => {
    const known = sum(personRows, "pricedKm");

    return known ? money(sum(personRows, "costCents") / known) : "—";
  };

  const estimate = (input: string) => {
    if (rate === null || input.trim() === "") return "—";

    const value = Number(input);

    return Number.isFinite(value) && value >= 0 && value <= 1000000
      ? money(Math.round(value * rate))
      : "—";
  };

  return (
    <>
      <div className={styles.filters}>
        <label htmlFor={id + "-period"}>
          Periode
          <select
            id={id + "-period"}
            value={period}
            onChange={(event) => {
              setPeriod(Number(event.target.value));
              resetSelection();
            }}
          >
            <option value={30}>Afgelopen 30 dagen</option>
            <option value={90}>Afgelopen 90 dagen</option>
            <option value={180}>Afgelopen 6 maanden · 180 dagen</option>
            <option value={365}>Afgelopen jaar · 365 dagen</option>
          </select>
        </label>

        <label htmlFor={id + "-driver"}>
          Bestuurder
          <select
            id={id + "-driver"}
            value={driver}
            onChange={(event) => {
              setDriver(event.target.value);
              resetSelection();
            }}
          >
            <option value="">Iedereen</option>

            {data.people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
                {person.formerMember ? " · voormalig lid" : ""}
              </option>
            ))}
          </select>
        </label>

        <span className={styles.small}>
          {dateLabel(from)} – {dateLabel(data.today)}
        </span>
      </div>

      {!data.startDate && (
        <p className={styles.warning}>
          Stel eerst het startpunt van deze auto in. Daarna kunnen we
          brandstofkosten aan ritten koppelen.
        </p>
      )}

      <div className={styles.metrics} aria-live="polite">
        <Card label="Gereden afstand" value={km(distance)} note={comparison} />

        <Card
          label="Gemiddelde brandstofkost"
          value={rate === null ? "—" : money(rate) + "/km"}
          note="Alleen kilometers met bekende kosten"
        />

        <Card
          label="Toegerekende brandstofkosten"
          value={money(cost)}
          note={km(pricedKm) + " met bekende kosten"}
        />

        <Card
          label="Gemiddelde rit"
          value={trips ? km(distance / trips) : "—"}
          note={trips + " geregistreerde ritten"}
        />
      </div>

      <div className={styles.mainGrid}>
        <Panel
          title={
            measure === "distance"
              ? "Kilometers doorheen de tijd"
              : "Brandstofkosten doorheen de tijd"
          }
          note="Selecteer een balk voor de verdeling. De eerste en laatste week of maand kunnen gedeeltelijk zijn."
        >
          <div className={styles.tabs} aria-label="Grafiekweergave">
            <button
              type="button"
              aria-pressed={measure === "distance"}
              onClick={() => {
                setMeasure("distance");
                setSelected(null);
              }}
            >
              Kilometers
            </button>

            <button
              type="button"
              aria-pressed={measure === "costCents"}
              onClick={() => {
                setMeasure("costCents");
                setSelected(null);
              }}
            >
              Kosten
            </button>
          </div>

          <Bars
            rows={chartRows}
            people={data.people}
            format={valueFormat}
            label="Gebruik per bestuurder"
            onSelect={setSelected}
          />

          {selected && (
            <p className={styles.selection} role="status">
              {selected.label}
              {" · "}
              {data.people
                .map(
                  (person, index) =>
                    person.name + ": " + valueFormat(selected.values[index]),
                )
                .join(" · ")}
            </p>
          )}
        </Panel>

        <Panel
          title="Wie rijdt hoeveel?"
          note="Gekozen periode · alle bestuurders"
        >
          <Bars
            rows={data.people.map((person, index) => ({
              key: person.userId,
              label: person.name,
              values: data.people.map((_, i) =>
                i === index
                  ? sum(
                      all.filter((row) => row.userId === person.userId),
                      "distance",
                    )
                  : 0,
              ),
            }))}
            format={km}
            label="Afstand per bestuurder"
          />

          <hr className={styles.rule} />

          <h3>Hoe volledig zijn de kosten?</h3>

          <p className={styles.small}>Voor de geselecteerde bestuurder(s).</p>

          <p>
            {distance ? numbers.format((pricedKm / distance) * 100) + "%" : "—"}{" "}
            van de kilometers heeft een kostprijs.
          </p>

          <p className={styles.small}>
            {km(pendingKm)} wacht op een volgende volle tank.
          </p>

          <p className={blockedKm ? styles.warning : styles.small}>
            {km(blockedKm)} zit in tankperiodes met ontbrekende of overlappende
            ritten.
          </p>
        </Panel>
      </div>

      <section className={styles.card}>
        <h2>Wat kosten je ritten en je maandgebruik?</h2>

        <p className={styles.small}>
          Schat de kost van een rit en bekijk je verwachte maandkost bij
          hetzelfde rijpatroon. Beide gebruiken de gemiddelde brandstofkost per
          kilometer van de geselecteerde periode en bestuurder. Dit is geen
          afrekening.
        </p>

        <div className={styles.estimators}>
          <label htmlFor={id + "-trip"}>
            Ritafstand (km)
            <input
              id={id + "-trip"}
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={estimateKm}
              onChange={(event) => setEstimateKm(event.target.value)}
            />
            <strong className={styles.estimate} aria-live="polite">
              {estimate(estimateKm)}
            </strong>
            <span className={styles.small}>
              Geschatte brandstofkost voor deze rit.
            </span>
          </label>

          <div aria-live="polite">
            <span className={styles.muted}>
              Maandkost bij je huidige rijpatroon
            </span>

            {!canEstimateMonth || monthlyKm === null || rate === null ? (
              <p className={styles.small}>Nog onvoldoende gegevens.</p>
            ) : (
              <>
                <strong className={styles.estimate}>
                  {money(Math.round(monthlyKm * rate))}
                </strong>

                <p className={styles.small}>
                  Ongeveer {km(monthlyKm)} per 30 dagen, als je blijft rijden
                  zoals in deze periode.
                </p>

                <p className={styles.small}>
                  Gebaseerd op {usageDays}{" "}
                  {usageDays === 1 ? "kalenderdag" : "kalenderdagen"}
                  {usageFrom !== null && (
                    <>
                      {" · "}
                      {dateLabel(usageFrom)} – {dateLabel(data.today)}
                    </>
                  )}
                  . Dagen zonder ritten tellen mee; dagen vóór het startpunt
                  niet. Vandaag is nog niet volledig.
                </p>
              </>
            )}
          </div>
        </div>

        {rate === null && (
          <p className={styles.warning}>
            Er zijn nog geen kilometers met bekende brandstofkosten in de
            geselecteerde periode voor deze bestuurder(s). Zodra die beschikbaar
            zijn, verschijnen hier de geschatte bedragen.
          </p>
        )}
      </section>

      <Panel
        title="Bestuurders vergeleken"
        note="Gekozen periode · alle bestuurders"
      >
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Bestuurder</th>
                <th>Afstand</th>
                <th>Aandeel</th>
                <th>Ritten</th>
                <th>Gem. rit</th>
                <th>Kostenaandeel</th>
                <th>€/km</th>
                <th>Betaald aan pomp</th>
              </tr>
            </thead>

            <tbody>
              {data.people.map((person, index) => {
                const personRows = all.filter(
                  (row) => row.userId === person.userId,
                );
                const personKm = sum(personRows, "distance");
                const count = sum(personRows, "trips");
                const totalKm = sum(all, "distance");

                return (
                  <tr key={person.userId}>
                    <td>
                      <span className={styles.dot + " " + series(index)} />{" "}
                      {person.name}
                      {person.formerMember && (
                        <span className={styles.small}>
                          {" · voormalig lid"}
                        </span>
                      )}
                    </td>

                    <td>{km(personKm)}</td>

                    <td>
                      {totalKm
                        ? numbers.format((personKm / totalKm) * 100) + "%"
                        : "—"}
                    </td>

                    <td>{count}</td>
                    <td>{count ? km(personKm / count) : "—"}</td>
                    <td>{money(sum(personRows, "costCents"))}</td>
                    <td>{ownRate(personRows)}</td>
                    <td>{money(sum(personRows, "paidCents"))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className={styles.small}>
          Kostenaandeel volgt de ritdatum; betaald aan de pomp volgt de
          tankdatum. Het verschil is geen openstaand saldo. Dat staat bij de
          afrekening.
        </p>
      </Panel>

      <details className={styles.more}>
        <summary>Meer inzichten · trends, rijpatronen en tankperiodes</summary>

        <div className={styles.moreContent}>
          <Panel
            title="Maandtrends"
            note="Afgelopen 12 kalendermaanden · huidige maand is nog bezig · dezelfde bestuurder en grafiekweergave"
          >
            <Bars
              rows={months}
              people={data.people}
              format={valueFormat}
              label="Maandtrends per bestuurder"
            />
          </Panel>

          <div className={styles.twoColumns}>
            <Panel
              title="Op welke dagen rij je?"
              note="Gemiddelde kilometers per voorkomen van die weekdag in de gekozen periode"
            >
              <Bars
                rows={dayRows}
                format={km}
                label="Gemiddelde afstand per weekdag"
              />
            </Panel>

            <Panel
              title="Werkweek of weekend?"
              note="Kilometers binnen de gekozen periode; dit zegt niets over het doel van een rit"
            >
              <Bars
                rows={[false, true].map((weekend) => ({
                  key: String(weekend),
                  label: weekend ? "Weekend" : "Ma–vr",
                  values: [
                    sum(
                      rows.filter((row) => weekday(row.date) >= 5 === weekend),
                      "distance",
                    ),
                  ],
                }))}
                format={km}
                label="Gebruik in werkweek en weekend"
              />

              <hr className={styles.rule} />

              <h3>Korte en lange ritten</h3>

              <Bars
                rows={[
                  {
                    key: "short",
                    label: "Onder 10 km",
                    values: [sum(rows, "shortTrips")],
                  },
                  {
                    key: "medium",
                    label: "10–50 km",
                    values: [sum(rows, "mediumTrips")],
                  },
                  {
                    key: "long",
                    label: "Boven 50 km",
                    values: [sum(rows, "longTrips")],
                  },
                ]}
                format={(value) => numbers.format(value) + " ritten"}
                label="Verdeling naar ritlengte"
              />

              <p className={styles.small}>
                Afstanden: {km(sum(rows, "shortKm"))} kort ·{" "}
                {km(sum(rows, "mediumKm"))} middellang ·{" "}
                {km(sum(rows, "longKm"))} lang.
              </p>
            </Panel>
          </div>

          <Panel
            title="Tankperiodes vergelijken"
            note="Hele auto · tankperiodes die eindigen binnen de gekozen periode"
          >
            {selectedTanks.length === 0 ? (
              <p className={styles.small}>Geen tankperiodes in deze periode.</p>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Tankperiode</th>
                        <th>Afstand</th>
                        <th>Bedrag</th>
                        <th>€/100 km</th>
                        <th>Betaler</th>
                        <th>Verdeling</th>
                      </tr>
                    </thead>

                    <tbody>
                      {selectedTanks
                        .slice(currentTankPage * 5, currentTankPage * 5 + 5)
                        .map((tank) => (
                          <tr key={tank.id}>
                            <td>
                              {dateLabel(tank.startDate)}
                              {" → "}
                              {dateLabel(tank.endDate)}
                            </td>

                            <td>{km(tank.distance)}</td>
                            <td>{money(tank.amountCents)}</td>

                            <td>
                              {money((tank.amountCents / tank.distance) * 100)}
                            </td>

                            <td>{tank.payerName}</td>

                            <td>
                              {tank.status === "complete"
                                ? "Volledig"
                                : tank.status === "overlapping-trips"
                                  ? "Overlap in ritten"
                                  : km(tank.missingDistance) + " ontbreekt"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {pages > 1 && (
                  <nav
                    className={styles.pagination}
                    aria-label="Tankperiodes pagineren"
                  >
                    <button
                      type="button"
                      disabled={currentTankPage === 0}
                      onClick={() => setTankPage(currentTankPage - 1)}
                    >
                      Vorige
                    </button>

                    <span>
                      {currentTankPage + 1} / {pages}
                    </span>

                    <button
                      type="button"
                      disabled={currentTankPage === pages - 1}
                      onClick={() => setTankPage(currentTankPage + 1)}
                    >
                      Volgende
                    </button>
                  </nav>
                )}
              </>
            )}

            <Bars
              rows={[...selectedTanks]
                .reverse()
                .slice(-12)
                .map((tank) => ({
                  key: tank.id,
                  label: dateLabel(tank.endDate),
                  values: [(tank.amountCents / tank.distance) * 100],
                }))}
              format={money}
              label="Brandstofkosten per 100 km per tankperiode"
            />

            <p className={styles.small}>
              €/100 km is het tankbedrag gedeeld door de afstand tussen twee
              volle tanks. Een onvolledige rittenregistratie blokkeert de
              verdeling over personen.
            </p>
          </Panel>
        </div>
      </details>

      <footer className={styles.footnote}>
        Gegevens vanaf{" "}
        {data.startDate
          ? dateLabel(data.startDate)
          : "het nog in te stellen startpunt"}
        . Vandaag is nog niet volledig. Kosten omvatten open én afgerekende
        volledige tankperiodes. Een rit wordt op zijn geregistreerde ritdatum
        geteld. Verschillen in €/km bewijzen geen verschil in rijzuinigheid.
        Alle bedragen betreffen uitsluitend brandstof.
      </footer>
    </>
  );
}
