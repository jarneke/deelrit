import { Suspense } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { searchCarHistory } from "@/actions/car-history-browser";
import type { HistoryBrowserFilters } from "@/lib/car-history-browser-types";
import { formatTripPayers, getTripPayers } from "@/lib/car-trip-payers";
import AppIcon from "@/components/app-icon";
import UserAvatar from "@/components/user-avatar";
import LoadingState from "@/components/loading-state";
import GlassSurface, { GlassScope } from "@/components/glass-surface";
import styles from "./page.module.css";

type SearchParameters = Record<string, string | string[] | undefined>;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParameters>;
};

export const metadata = {
  title: "Historiek | Deelrit",
};

const numbers = new Intl.NumberFormat("nl-BE");

const euros = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(value));
}

function read(parameters: SearchParameters, name: string, fallback = "") {
  const value = parameters[name];
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function queryValues(filters: HistoryBrowserFilters) {
  return {
    kind: filters.kind,
    q: filters.search,
    person: filters.person,
    from: filters.from,
    to: filters.to,
    status: filters.status,
    sort: filters.sort,
    pageSize: String(filters.pageSize),
    page: String(filters.page),
  };
}

function pageNumbers(current: number, last: number) {
  return [
    ...new Set([
      1,
      current - 2,
      current - 1,
      current,
      current + 1,
      current + 2,
      last,
    ]),
  ]
    .filter((page) => page >= 1 && page <= last)
    .sort((a, b) => a - b);
}

export default function HistoryPage(props: Props) {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Historiek laden…"
          description="We halen je ritten en tankbeurten op."
        />
      }
    >
      <HistoryContent {...props} />
    </Suspense>
  );
}

async function HistoryContent({ params, searchParams }: Props) {
  await requireSession();

  const [{ id }, parameters] = await Promise.all([params, searchParams]);
  const path = "/auto/" + encodeURIComponent(id) + "/historiek";
  const carPath = "/auto/" + encodeURIComponent(id);

  const result = await searchCarHistory(id, {
    kind: read(parameters, "kind") === "refuels" ? "refuels" : "trips",
    search: read(parameters, "q"),
    person: read(parameters, "person"),
    from: read(parameters, "from"),
    to: read(parameters, "to"),
    status: read(parameters, "status", "all"),
    sort: read(parameters, "sort", "date-desc"),
    page: Number(read(parameters, "page", "1")),
    pageSize: Number(read(parameters, "pageSize", "20")),
  });

  if (!result.success) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <Link href={carPath} className={styles.back}>
            <AppIcon name="arrow-left" size={18} />
            Terug naar je auto
          </Link>

          <GlassSurface as="section" className={styles.errorCard}>
            <h1>Historiek</h1>
            <p role="alert">{result.error}</p>
            <Link href={path} className={styles.primary}>
              Opnieuw openen
            </Link>
          </GlassSurface>
        </div>
      </main>
    );
  }

  const data = result.data;
  const filters = data.filters;
  const trips = filters.kind === "trips";
  const values = queryValues(filters);
  const pages = pageNumbers(filters.page, data.pageCount);
  const first =
    data.total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const last = Math.min(filters.page * filters.pageSize, data.total);

  function href(patch: Partial<HistoryBrowserFilters>) {
    const query = new URLSearchParams(queryValues({ ...filters, ...patch }));

    return path + "?" + query.toString();
  }

  return (
    <main className={styles.page}>
      <GlassScope className={styles.container}>
        <Link data-glass href={carPath} className={styles.back}>
          <AppIcon name="arrow-left" size={18} />
          Terug naar je auto
        </Link>

        <header className={styles.heading}>
          <p className={styles.eyebrow}>Alles bijgehouden</p>
          <h1>Historiek</h1>
          <p>Zoek een registratie of bekijk een specifieke periode.</p>
        </header>

        <nav data-glass className={styles.tabs} aria-label="Soort historiek">
          <Link
            href={href({ kind: "trips", person: "", page: 1 })}
            aria-current={trips ? "page" : undefined}
          >
            <AppIcon name="car" size={18} />
            Ritten
          </Link>

          <Link
            href={href({ kind: "refuels", person: "", page: 1 })}
            aria-current={!trips ? "page" : undefined}
          >
            <AppIcon name="wallet" size={18} />
            Tankbeurten
          </Link>
        </nav>

        <GlassSurface as="section" className={styles.filterCard}>
          <form action={path} method="get" className={styles.filters}>
            <input type="hidden" name="kind" value={filters.kind} />

            <label className={styles.search}>
              Zoeken
              <input
                type="search"
                name="q"
                defaultValue={filters.search}
                maxLength={120}
                placeholder={
                  trips
                    ? "Naam, opmerking of kilometerstand"
                    : "Naam, bedrag of kilometerstand"
                }
              />
            </label>

            <label>
              Persoon
              <select name="person" defaultValue={filters.person}>
                <option value="">Iedereen</option>
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.id.startsWith("guest:") ? " · gast" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Vanaf
              <input
                type="date"
                name="from"
                min="1900-01-01"
                max="9998-12-31"
                defaultValue={filters.from}
              />
            </label>

            <label>
              Tot en met
              <input
                type="date"
                name="to"
                min="1900-01-01"
                max="9998-12-31"
                defaultValue={filters.to}
              />
            </label>

            <label>
              Status
              <select name="status" defaultValue={filters.status}>
                <option value="all">Alles</option>
                <option value="open">Niet afgerekend</option>
                <option value="settled">Afgerekend</option>
              </select>
            </label>

            <label>
              Sortering
              <select name="sort" defaultValue={filters.sort}>
                <option value="date-desc">Nieuwste datum eerst</option>
                <option value="date-asc">Oudste datum eerst</option>
                <option value="odometer-desc">Hoogste stand eerst</option>
                <option value="odometer-asc">Laagste stand eerst</option>
                <option value="value-desc">
                  {trips ? "Langste rit eerst" : "Hoogste bedrag eerst"}
                </option>
                <option value="value-asc">
                  {trips ? "Kortste rit eerst" : "Laagste bedrag eerst"}
                </option>
              </select>
            </label>

            <label>
              Per pagina
              <select name="pageSize" defaultValue={String(filters.pageSize)}>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>

            <div className={styles.filterActions}>
              <Link
                href={path + "?kind=" + filters.kind}
                className={styles.reset}
              >
                Wissen
              </Link>

              <button type="submit" className={styles.primary}>
                <AppIcon name="check" size={18} />
                Toepassen
              </button>
            </div>
          </form>
        </GlassSurface>

        <div className={styles.resultsHeading}>
          <h2>{trips ? "Ritten" : "Tankbeurten"}</h2>
          <p>
            {numbers.format(first)}–{numbers.format(last)}
            {" van "}
            {numbers.format(data.total)}
          </p>
        </div>

        {data.total === 0 ? (
          <GlassSurface className={styles.empty}>
            <AppIcon name={trips ? "car" : "wallet"} size={28} />
            <h3>Geen resultaten</h3>
            <p>Pas je zoekterm of filters aan.</p>
          </GlassSurface>
        ) : (
          <ol className={styles.list}>
            {trips
              ? data.trips.map((trip) => {
                  const payers = getTripPayers(trip);
                  const payer = payers[0];
                  const shared = payers.length > 1;

                  return (
                    <li key={trip.id}>
                      <GlassSurface as="article" className={styles.record}>
                        <span className={styles.avatar} aria-hidden="true">
                          {shared ? (
                            <AppIcon name="users" size={20} />
                          ) : (
                            <UserAvatar
                              name={payer.name}
                              userId={
                                payer.kind === "member" ? payer.userId : null
                              }
                            />
                          )}
                        </span>

                        <div className={styles.recordInfo}>
                          <h3>{formatTripPayers(trip)}</h3>

                          <p>
                            {dateLabel(trip.tripDate)}
                            {trip.endedAt
                              ? " · " + timeLabel(trip.endedAt)
                              : " · tijd onbekend"}
                          </p>

                          <p className={styles.odometer}>
                            {numbers.format(trip.startOdometer)}
                            {" → "}
                            {numbers.format(trip.endOdometer)} km
                          </p>

                          {trip.description && (
                            <p className={styles.description}>
                              {trip.description}
                            </p>
                          )}
                        </div>

                        <div className={styles.recordResult}>
                          <strong>
                            {numbers.format(
                              trip.endOdometer - trip.startOdometer,
                            )}{" "}
                            km
                          </strong>

                          <span
                            className={
                              trip.settledLocked ? styles.settled : styles.open
                            }
                          >
                            {trip.settledLocked
                              ? "Afgerekend"
                              : "Niet afgerekend"}
                          </span>
                        </div>
                      </GlassSurface>
                    </li>
                  );
                })
              : data.refuels.map((refuel) => (
                  <li key={refuel.id}>
                    <GlassSurface as="article" className={styles.record}>
                      <span className={styles.avatar} aria-hidden="true">
                        <UserAvatar
                          name={refuel.payerName}
                          userId={refuel.paidBy}
                        />
                      </span>

                      <div className={styles.recordInfo}>
                        <h3>{refuel.payerName}</h3>
                        <p>{dateLabel(refuel.tankDate)} · volle tank</p>

                        <p className={styles.odometer}>
                          {numbers.format(refuel.odometer)} km
                        </p>

                        {refuel.boundaryLocked && !refuel.settledAt && (
                          <p className={styles.description}>
                            Datum en stand begrenzen een afgerekende periode.
                          </p>
                        )}
                      </div>

                      <div className={styles.recordResult}>
                        <strong>
                          {euros.format(refuel.amountCents / 100)}
                        </strong>

                        <span
                          className={
                            refuel.settledAt ? styles.settled : styles.open
                          }
                        >
                          {refuel.settledAt ? "Afgerekend" : "Niet afgerekend"}
                        </span>
                      </div>
                    </GlassSurface>
                  </li>
                ))}
          </ol>
        )}

        {data.pageCount > 1 && (
          <GlassSurface className={styles.pagination}>
            <nav aria-label="Historiekpagina’s">
              {filters.page > 1 ? (
                <Link
                  href={href({ page: filters.page - 1 })}
                  aria-label="Vorige pagina"
                  className={styles.pageButton}
                >
                  <AppIcon name="arrow-left" size={18} />
                </Link>
              ) : (
                <span aria-disabled="true" className={styles.pageButton}>
                  <AppIcon name="arrow-left" size={18} />
                </span>
              )}

              {pages.map((page, index) => (
                <span key={page} className={styles.pageItem}>
                  {index > 0 && page - pages[index - 1] > 1 && (
                    <span className={styles.ellipsis}>…</span>
                  )}

                  <Link
                    href={href({ page })}
                    className={styles.pageButton}
                    aria-current={page === filters.page ? "page" : undefined}
                    aria-label={"Pagina " + page}
                  >
                    {page}
                  </Link>
                </span>
              ))}

              {filters.page < data.pageCount ? (
                <Link
                  href={href({ page: filters.page + 1 })}
                  aria-label="Volgende pagina"
                  className={styles.pageButton}
                >
                  <AppIcon name="arrow-right" size={18} />
                </Link>
              ) : (
                <span aria-disabled="true" className={styles.pageButton}>
                  <AppIcon name="arrow-right" size={18} />
                </span>
              )}
            </nav>

            <form action={path} method="get" className={styles.jump}>
              {Object.entries(values)
                .filter(([name]) => name !== "page")
                .map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}

              <label>
                Ga naar pagina
                <input
                  type="number"
                  name="page"
                  min="1"
                  max={data.pageCount}
                  defaultValue={filters.page}
                  required
                />
              </label>

              <button
                type="submit"
                className={styles.pageButton}
                aria-label="Open gekozen pagina"
              >
                <AppIcon name="arrow-right" size={18} />
              </button>
            </form>
          </GlassSurface>
        )}

        {!trips && data.startpoint && (
          <p className={styles.startpoint}>
            Start registratie: {dateLabel(data.startpoint.tankDate)}
            {" · "}
            {numbers.format(data.startpoint.odometer)} km. Het startpunt telt
            niet als betaalde tankbeurt.
          </p>
        )}
      </GlassScope>
    </main>
  );
}
