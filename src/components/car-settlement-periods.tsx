"use client";

import { useEffect, useState } from "react";
import { getCarPeriodPage } from "@/actions/car-settlement-view";
import type { SettlementPeriod } from "@/lib/car-settlement";
import type { SettlementPeriodPage } from "@/lib/car-settlement-view-types";
import ActionButton from "./action-button";
import styles from "./car-settlement.module.css";

type Props = {
  organizationId: string;
  settled: boolean;
  total: number;
  revision: string;
  isOwner: boolean;
  busy: boolean;
  pendingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (period: SettlementPeriod) => Promise<void>;
  onRefresh: () => void;
};

type PeriodCardProps = {
  period: SettlementPeriod;
  isOwner: boolean;
  busy: boolean;
  pendingId: string | null;
  onChange: (period: SettlementPeriod) => Promise<void>;
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

function formatMoment(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(value));
}

function PeriodCard({
  period,
  isOwner,
  busy,
  pendingId,
  onChange,
}: PeriodCardProps) {
  const complete = period.status === "complete";
  const settled = period.settledAt !== null;
  const pending = pendingId === period.id;

  const statusLabel = settled
    ? "Afgerekend"
    : complete
      ? "Volledig"
      : period.status === "overlapping-trips"
        ? "Overlap in ritten"
        : `${numbers.format(period.missingDistance)} km ontbreekt`;

  return (
    <details className={styles.period}>
      <summary className={styles.periodSummary}>
        <span className={styles.periodIdentity}>
          <span className={styles.name}>
            {formatDate(period.startDate)}
            {" → "}
            {formatDate(period.endDate)}
          </span>

          <span className={styles.detail}>
            {numbers.format(period.startOdometer)}
            {" → "}
            {numbers.format(period.endOdometer)} km
          </span>
        </span>

        <span className={styles.periodResult}>
          <strong className={styles.amount}>{money(period.amountCents)}</strong>

          <span
            className={
              settled || complete
                ? styles.completeBadge
                : styles.incompleteBadge
            }
          >
            {statusLabel}
          </span>
        </span>
      </summary>

      <div className={styles.periodBody}>
        <p className={styles.description}>
          {numbers.format(period.distance)}
          {" km · Betaald door "}
          <strong>{period.payerName}</strong>
        </p>

        {settled && period.settledAt && (
          <p className={styles.detail}>
            Afgerekend op {formatMoment(period.settledAt)}. Deze periode telt
            niet mee voor de openstaande betalingen.
          </p>
        )}

        {complete ? (
          <ul className={styles.shareList}>
            {period.shares.map((share) => (
              <li key={share.userId} className={styles.share}>
                <div className={styles.person}>
                  <p className={styles.name}>{share.name}</p>

                  <p className={styles.detail}>
                    {numbers.format(share.distance)} km
                    {share.userId === period.paidBy
                      ? " · Eigen aandeel van de betaler"
                      : ""}
                  </p>
                </div>

                <strong className={styles.amount}>
                  {money(share.amountCents)}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.warning}>
            <h4 className={styles.smallHeading}>
              {period.status === "overlapping-trips"
                ? "Er overlappen ritten"
                : "Er ontbreken ritten"}
            </h4>

            <p>Deze periode telt nog niet mee voor de betalingen.</p>

            {period.gaps.length > 0 && (
              <ul className={styles.gaps}>
                {period.gaps.map((gap) => (
                  <li key={`${gap.start}-${gap.end}`}>
                    {numbers.format(gap.start)}
                    {" → "}
                    {numbers.format(gap.end)}
                    {" km · "}
                    {numbers.format(gap.end - gap.start)}
                    {" km ontbreekt"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isOwner && (
          <div className={styles.periodActions}>
            <p className={styles.detail}>
              {settled
                ? "Opnieuw openen laat deze periode weer meetellen voor de openstaande betalingen."
                : "Markeer deze periode pas als afgerekend wanneer alle bijbehorende terugbetalingen verwerkt zijn."}
            </p>

            <ActionButton
              icon={settled ? "undo" : "check"}
              loading={pending}
              className={styles.secondary}
              disabled={busy || (!settled && !complete)}
              onClick={() => void onChange(period)}
            >
              {pending
                ? "Opslaan…"
                : settled
                  ? "Opnieuw openen"
                  : "Markeer als afgerekend"}
            </ActionButton>
          </div>
        )}
      </div>
    </details>
  );
}

export default function CarSettlementPeriods({
  organizationId,
  settled,
  total,
  revision,
  isOwner,
  busy,
  pendingId,
  open,
  onOpenChange,
  onChange,
  onRefresh,
}: Props) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [data, setData] = useState<SettlementPeriodPage | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setRefreshRequired(false);

      try {
        const result = await getCarPeriodPage(organizationId, settled, page);

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          setRefreshRequired(result.refreshRequired ?? false);
          return;
        }

        if (result.data.revision !== revision) {
          setError(
            "De afrekening is ondertussen veranderd. Vernieuw het overzicht om de actuele tankperiodes te bekijken.",
          );
          setRefreshRequired(true);
          return;
        }

        setData(result.data);
      } catch {
        if (!cancelled) {
          setError(
            "De tankperiodes konden niet worden geladen. Probeer opnieuw.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, settled, page, retry, revision]);

  const pageCount = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  const firstIndex = data ? data.page * data.pageSize : 0;

  function changePage(nextPage: number) {
    if (busy || loading) return;

    setLoading(true);
    setPage(nextPage);
  }

  return (
    <details
      className={styles.sectionFold}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <h3>{settled ? "Afgerekende tankperiodes" : "Open tankperiodes"}</h3>

        <span className={styles.count}>{data?.total ?? total}</span>
      </summary>

      {open && (
        <>
          <p className={styles.foldDescription}>
            {settled
              ? "Deze periodes blijven bewaard en tellen niet mee voor de openstaande betalingen."
              : "Bekijk de kilometerverdeling per periode."}
            {!settled && isOwner
              ? " Als eigenaar kun je ook een afzonderlijke volledige periode als afgerekend markeren."
              : ""}
          </p>

          {loading ? (
            <p className={styles.detail} role="status">
              Tankperiodes laden…
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
          ) : !data || data.items.length === 0 ? (
            <p className={styles.empty}>
              {settled
                ? "Nog geen tankperiodes als afgerekend gemarkeerd."
                : "Geen open tankperiodes."}
            </p>
          ) : (
            <>
              <div className={styles.periods}>
                {data.items.map((period) => (
                  <PeriodCard
                    key={period.id}
                    period={period}
                    isOwner={isOwner}
                    busy={busy}
                    pendingId={pendingId}
                    onChange={onChange}
                  />
                ))}
              </div>

              {pageCount > 1 && (
                <nav
                  className={styles.pagination}
                  aria-label={
                    settled
                      ? "Afgerekende tankperiodes pagineren"
                      : "Open tankperiodes pagineren"
                  }
                >
                  <span>
                    {firstIndex + 1}–
                    {Math.min(firstIndex + data.pageSize, data.total)}
                    {" van "}
                    {data.total}
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

                    <span aria-live="polite">
                      {data.page + 1} / {pageCount}
                    </span>

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
            </>
          )}
        </>
      )}
    </details>
  );
}
