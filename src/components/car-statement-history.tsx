"use client";

import { useEffect, useState } from "react";
import {
  getCarStatementHistory,
  type StatementHistoryItem,
} from "@/actions/car-settlement";
import ActionButton from "./action-button";
import styles from "./car-settlement.module.css";

const euros = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

const numbers = new Intl.NumberFormat("nl-BE");

function money(cents: number) {
  return euros.format(cents / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function moment(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(value));
}

export default function CarStatementHistory({
  organizationId,
}: {
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<StatementHistoryItem[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setBusy(true);
      setError("");

      try {
        const result = await getCarStatementHistory(organizationId, page);

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          return;
        }

        const lastPage = Math.max(0, Math.ceil(result.total / 5) - 1);

        if (page > lastPage) {
          setPage(lastPage);
          return;
        }

        setItems(result.items);
        setTotal(result.total);
      } catch {
        if (!cancelled) {
          setError("De historiek kon niet worden geladen.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, page, retry]);

  function changePage(next: number) {
    setBusy(true);
    setPage(next);
  }

  return (
    <section className={styles.panel}>
      <details
        className={styles.sectionFold}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <h3>Afrekenhistoriek</h3>
        </summary>

        <p className={styles.foldDescription}>
          Vaste overzichten van afrekeningen die als afbetaald gemarkeerd zijn.
          Eerder afgesloten periodes zonder bewaard overzicht staan bij
          ‘Afgerekende tankperiodes’.
        </p>

        {busy ? (
          <p className={styles.detail} role="status">
            Je afrekenhistoriek laden…
          </p>
        ) : error ? (
          <div>
            <p role="alert" className={styles.error}>
              {error}
            </p>

            <ActionButton
              icon="undo"
              className={styles.secondary}
              onClick={() => {
                setBusy(true);
                setRetry((value) => value + 1);
              }}
            >
              Opnieuw proberen
            </ActionButton>
          </div>
        ) : items.length === 0 ? (
          <p className={styles.empty}>Nog geen afrekeningen bewaard.</p>
        ) : (
          <>
            <div className={styles.periods}>
              {items.map((item) => (
                <details key={item.id} className={styles.period}>
                  <summary className={styles.periodSummary}>
                    <span className={styles.periodIdentity}>
                      <span className={styles.name}>
                        {moment(item.created_at)}
                      </span>

                      <span className={styles.detail}>
                        Afgerond door {item.snapshot.completedByName}
                        {" · "}
                        {item.snapshot.periods.length}{" "}
                        {item.snapshot.periods.length === 1
                          ? "tankperiode"
                          : "tankperiodes"}
                      </span>
                    </span>

                    <span
                      className={
                        item.reopened_at
                          ? styles.incompleteBadge
                          : styles.completeBadge
                      }
                    >
                      {item.reopened_at
                        ? "Bevat heropende periode"
                        : "Als afbetaald gemarkeerd"}
                    </span>
                  </summary>

                  <div className={styles.periodBody}>
                    {item.reopened_at && (
                      <div className={styles.warning}>
                        <p>
                          Op {moment(item.reopened_at)} is een betrokken periode
                          opnieuw geopend. Dit is het oorspronkelijke overzicht.
                          Kijk bij de open afrekening voor wat er nu nog te
                          betalen is.
                        </p>
                      </div>
                    )}

                    <h4 className={styles.smallHeading}>
                      Wie moest aan wie betalen?
                    </h4>

                    {item.snapshot.transfers.length === 0 ? (
                      <p className={styles.detail}>
                        Er waren geen onderlinge betalingen nodig.
                      </p>
                    ) : (
                      <ul className={styles.shareList}>
                        {item.snapshot.transfers.map((transfer) => (
                          <li
                            key={`${transfer.fromUserId}:${transfer.toUserId}`}
                            className={styles.share}
                          >
                            <div className={styles.person}>
                              <p className={styles.name}>
                                {transfer.fromName} → {transfer.toName}
                              </p>
                              <p className={styles.detail}>
                                Na verrekening van wederzijdse schulden
                              </p>
                            </div>

                            <strong className={styles.amount}>
                              {money(transfer.amountCents)}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h4 className={styles.smallHeading}>
                      Betrokken tankperiodes
                    </h4>

                    <ul className={styles.shareList}>
                      {item.snapshot.periods.map((period) => (
                        <li key={period.id} className={styles.share}>
                          <div className={styles.person}>
                            <p className={styles.name}>
                              {date(period.startDate)} → {date(period.endDate)}
                            </p>

                            <p className={styles.detail}>
                              {numbers.format(period.startOdometer)} →{" "}
                              {numbers.format(period.endOdometer)} km
                              {" · Betaald door "}
                              {period.payerName}
                            </p>
                          </div>

                          <strong className={styles.amount}>
                            {money(period.amountCents)}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>

            {total > 5 && (
              <nav
                className={styles.pagination}
                aria-label="Afrekenhistoriek pagineren"
              >
                <span>
                  {page * 5 + 1}–{Math.min(page * 5 + 5, total)} van {total}
                </span>

                <div className={styles.pageActions}>
                  <ActionButton
                    icon="arrow-left"
                    className={styles.secondary}
                    disabled={page === 0}
                    onClick={() => changePage(page - 1)}
                  >
                    Vorige
                  </ActionButton>

                  <span aria-live="polite">
                    {page + 1} / {Math.ceil(total / 5)}
                  </span>

                  <ActionButton
                    icon="arrow-right"
                    className={styles.secondary}
                    disabled={(page + 1) * 5 >= total}
                    onClick={() => changePage(page + 1)}
                  >
                    Volgende
                  </ActionButton>
                </div>
              </nav>
            )}
          </>
        )}
      </details>
    </section>
  );
}
