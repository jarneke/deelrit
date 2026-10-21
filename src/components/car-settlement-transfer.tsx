"use client";

import { useEffect, useState } from "react";
import { getCarTransferPage } from "@/actions/car-settlement-view";
import type { PaymentSource } from "@/lib/car-settlement";
import type {
  SettlementTransferSummary,
  TransferDetailPage,
} from "@/lib/car-settlement-view-types";
import ActionButton from "./action-button";
import styles from "./car-settlement.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  transfer: SettlementTransferSummary;
  revision: string;
  busy: boolean;
  group?: boolean;
  onRefresh: () => void;
};

const numbers = new Intl.NumberFormat("nl-BE");
const euros = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

function money(cents: number) {
  return euros.format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}

function SourceList({ sources }: { sources: PaymentSource[] }) {
  if (sources.length === 0) {
    return <p className={styles.detail}>Geen bijdragen op deze pagina.</p>;
  }

  return (
    <ul className={styles.sourceList}>
      {sources.map((source) => (
        <li key={source.periodId} className={styles.source}>
          <div>
            <p>Tankbeurt van {formatDate(source.tankDate)}</p>
            <p className={styles.detail}>
              {numbers.format(source.distance)} km binnen{" "}
              {numbers.format(source.startOdometer)}
              {" → "}
              {numbers.format(source.endOdometer)} km
            </p>
          </div>

          <strong className={styles.amount}>{money(source.amountCents)}</strong>
        </li>
      ))}
    </ul>
  );
}

export default function CarSettlementTransfer({
  organizationId,
  currentUserId,
  transfer,
  revision,
  busy,
  group = false,
  onRefresh,
}: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [data, setData] = useState<TransferDetailPage | null>(null);

  const fromUserId = transfer.fromUserId;
  const toUserId = transfer.toUserId;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setRefreshRequired(false);

      try {
        const result = await getCarTransferPage(
          organizationId,
          fromUserId,
          toUserId,
          page,
        );

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          setRefreshRequired(result.refreshRequired ?? false);
          return;
        }

        if (result.data.revision !== revision) {
          setError(
            "De afrekening is ondertussen veranderd. Vernieuw het overzicht om de actuele bedragen te bekijken.",
          );
          setRefreshRequired(true);
          return;
        }

        setData(result.data);
      } catch {
        if (!cancelled) {
          setError("De betaalopbouw kon niet worden geladen. Probeer opnieuw.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, fromUserId, toUserId, page, retry, revision]);

  const outgoing = fromUserId === currentUserId;
  const from = outgoing ? "Jij" : transfer.fromName;
  const to = toUserId === currentUserId ? "Jij" : transfer.toName;
  const otherName = outgoing ? transfer.toName : transfer.fromName;

  const title = group
    ? `${from} → ${to}`
    : outgoing
      ? `Aan ${transfer.toName}`
      : `Van ${transfer.fromName}`;

  const pageCount = data
    ? Math.max(
        1,
        Math.ceil(
          Math.max(data.sourceTotal, data.offsetSourceTotal) / data.pageSize,
        ),
      )
    : 1;

  function changePage(nextPage: number) {
    if (busy || loading) return;

    setLoading(true);
    setPage(nextPage);
  }

  return (
    <details
      className={styles.transfer}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.transferSummary}>
        <span className={styles.transferIdentity}>
          {!group && (
            <span className={styles.avatar} aria-hidden="true">
              {initials(otherName)}
            </span>
          )}

          <span className={styles.person}>
            <span className={styles.name}>{title}</span>

            {!group && (
              <span className={styles.detail}>
                {outgoing ? "Jij betaalt" : "Jij krijgt terug"}
              </span>
            )}
          </span>
        </span>

        <span className={styles.transferResult}>
          <strong
            className={
              !group && !outgoing ? styles.receives : styles.transferAmount
            }
          >
            {money(transfer.amountCents)}
          </strong>

          <span className={styles.detail}>Bekijk opbouw</span>
        </span>
      </summary>

      {open && (
        <div className={styles.transferBody}>
          {loading ? (
            <p className={styles.detail} role="status">
              Betaalopbouw laden…
            </p>
          ) : error ? (
            <div>
              <p className={styles.error} role="alert">
                {error}
              </p>

              <ActionButton
                icon={refreshRequired ? "loader" : "undo"}
                className={styles.secondary}
                disabled={busy}
                onClick={() => {
                  if (refreshRequired) {
                    onRefresh();
                  } else {
                    setLoading(true);
                    setRetry((value) => value + 1);
                  }
                }}
              >
                {refreshRequired ? "Overzicht vernieuwen" : "Opnieuw proberen"}
              </ActionButton>
            </div>
          ) : data ? (
            <>
              <h4 className={styles.smallHeading}>
                Aandeel van {transfer.fromName} in tankbeurten betaald door{" "}
                {transfer.toName}
              </h4>

              <p className={styles.detail}>
                {data.sourceTotal}{" "}
                {data.sourceTotal === 1 ? "bijdrage" : "bijdragen"}
                {" · "}
                {data.transfer.sources.length} op deze pagina
              </p>

              <SourceList sources={data.transfer.sources} />

              <div className={styles.totalRow}>
                <span>Subtotaal van alle bijdragen</span>
                <strong>{money(transfer.grossAmountCents)}</strong>
              </div>

              {transfer.offsetAmountCents > 0 && (
                <details className={styles.offset}>
                  <summary>
                    <span>Wederzijds verrekend</span>
                    <strong>− {money(transfer.offsetAmountCents)}</strong>
                  </summary>

                  <p className={styles.detail}>
                    {transfer.toName} heeft ook een aandeel in tankbeurten
                    betaald door {transfer.fromName}. Dat trekken we van deze
                    betaling af.
                  </p>

                  <p className={styles.detail}>
                    {data.offsetSourceTotal}{" "}
                    {data.offsetSourceTotal === 1 ? "bijdrage" : "bijdragen"}
                    {" · "}
                    {data.transfer.offsetSources.length} op deze pagina
                  </p>

                  <SourceList sources={data.transfer.offsetSources} />
                </details>
              )}

              {pageCount > 1 && (
                <nav
                  className={styles.pagination}
                  aria-label="Bijdragen aan betaling pagineren"
                >
                  <span aria-live="polite">
                    Bijdragenpagina {data.page + 1} / {pageCount}
                  </span>

                  <div className={styles.pageActions}>
                    <ActionButton
                      icon="arrow-left"
                      className={styles.secondary}
                      disabled={busy || data.page === 0}
                      onClick={() => changePage(data.page - 1)}
                    >
                      Vorige
                    </ActionButton>

                    <ActionButton
                      icon="arrow-right"
                      className={styles.secondary}
                      disabled={busy || data.page === pageCount - 1}
                      onClick={() => changePage(data.page + 1)}
                    >
                      Volgende
                    </ActionButton>
                  </div>
                </nav>
              )}

              <div className={styles.totalRow}>
                <strong>Te betalen</strong>
                <strong>{money(transfer.amountCents)}</strong>
              </div>
            </>
          ) : null}
        </div>
      )}
    </details>
  );
}
