"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setCarPeriodSettled,
  settleCarStatement,
} from "@/actions/car-settlement";
import {
  calculateCarSettlement,
  type PaymentSource,
  type SettlementPeriod,
  type SettlementRefuel,
  type SettlementTransfer,
  type SettlementTrip,
} from "@/lib/car-settlement";
import { getCarSettlementSnapshot } from "@/lib/car-settlement-snapshot";
import styles from "./car-settlement.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  startpoint: {
    tankDate: string;
    odometer: number;
  };
  trips: SettlementTrip[];
  refuels: SettlementRefuel[];
};

type PaginationProps = {
  page: number;
  total: number;
  onChange: (page: number) => void;
};

type TransferCardProps = {
  transfer: SettlementTransfer;
  currentUserId: string;
  group?: boolean;
};

type PeriodCardProps = {
  period: SettlementPeriod;
  isOwner: boolean;
  busy: boolean;
  pendingId: string | null;
  onChange: (period: SettlementPeriod) => Promise<void>;
};

const PAGE_SIZE = 5;

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

function safePage(page: number, total: number) {
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return Math.min(Math.max(page, 0), lastPage);
}

function Pagination({ page, total, onChange }: PaginationProps) {
  if (total <= PAGE_SIZE) {
    return null;
  }

  const currentPage = safePage(page, total);
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const first = currentPage * PAGE_SIZE + 1;
  const last = Math.min((currentPage + 1) * PAGE_SIZE, total);

  return (
    <nav className={styles.pagination} aria-label="Tankperiodes pagineren">
      <span>
        {first}–{last} van {total}
      </span>

      <div className={styles.pageActions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={currentPage === 0}
          onClick={() => onChange(currentPage - 1)}
        >
          ← Vorige
        </button>

        <span aria-live="polite">
          {currentPage + 1} / {pageCount}
        </span>

        <button
          type="button"
          className={styles.secondary}
          disabled={currentPage === pageCount - 1}
          onClick={() => onChange(currentPage + 1)}
        >
          Volgende →
        </button>
      </div>
    </nav>
  );
}

function SourceList({ sources }: { sources: PaymentSource[] }) {
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

function TransferCard({
  transfer,
  currentUserId,
  group = false,
}: TransferCardProps) {
  const outgoing = transfer.fromUserId === currentUserId;

  const from =
    transfer.fromUserId === currentUserId ? "Jij" : transfer.fromName;

  const to = transfer.toUserId === currentUserId ? "Jij" : transfer.toName;

  const otherName = outgoing ? transfer.toName : transfer.fromName;

  const title = group
    ? `${from} → ${to}`
    : outgoing
      ? `Aan ${transfer.toName}`
      : `Van ${transfer.fromName}`;

  return (
    <details className={styles.transfer}>
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

          <span className={styles.detail}>Bekijk opbouw ⌄</span>
        </span>
      </summary>

      <div className={styles.transferBody}>
        <h4 className={styles.smallHeading}>
          Aandeel van {transfer.fromName} in tankbeurten betaald door{" "}
          {transfer.toName}
        </h4>

        <SourceList sources={transfer.sources} />

        <div className={styles.totalRow}>
          <span>Subtotaal</span>
          <strong>{money(transfer.grossAmountCents)}</strong>
        </div>

        {transfer.offsetAmountCents > 0 && (
          <details className={styles.offset}>
            <summary>
              <span>Wederzijds verrekend ⌄</span>

              <strong>− {money(transfer.offsetAmountCents)}</strong>
            </summary>

            <p className={styles.detail}>
              {transfer.toName} heeft ook een aandeel in tankbeurten betaald
              door {transfer.fromName}. Dat trekken we van deze betaling af.
            </p>

            <SourceList sources={transfer.offsetSources} />
          </details>
        )}

        <div className={styles.totalRow}>
          <strong>Te betalen</strong>
          <strong>{money(transfer.amountCents)}</strong>
        </div>
      </div>
    </details>
  );
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

            <button
              type="button"
              className={styles.secondary}
              disabled={busy || (!settled && !complete)}
              onClick={() => void onChange(period)}
            >
              {pending
                ? "Opslaan…"
                : settled
                  ? "Opnieuw openen"
                  : "Markeer als afgerekend"}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

export default function CarSettlement({
  organizationId,
  currentUserId,
  isOwner,
  startpoint,
  trips,
  refuels,
}: Props) {
  const router = useRouter();

  const [openPage, setOpenPage] = useState(0);
  const [settledPage, setSettledPage] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const busy = pendingId !== null || refreshing;

  const settlement = useMemo(
    () => calculateCarSettlement(startpoint, trips, refuels),
    [startpoint, trips, refuels],
  );

  const outgoing = settlement.transfers.filter(
    (transfer) => transfer.fromUserId === currentUserId,
  );

  const incoming = settlement.transfers.filter(
    (transfer) => transfer.toUserId === currentUserId,
  );

  const totalToPay = outgoing.reduce(
    (total, transfer) => total + transfer.amountCents,
    0,
  );

  const totalToReceive = incoming.reduce(
    (total, transfer) => total + transfer.amountCents,
    0,
  );

  const completePeriods = settlement.periods.filter(
    (period) => period.status === "complete",
  );

  const firstComplete = completePeriods[0];

  const lastComplete = completePeriods[completePeriods.length - 1];

  const openPeriods = [...settlement.periods].reverse();

  const settledPeriods = [...settlement.settledPeriods].reverse();

  const currentOpenPage = safePage(openPage, openPeriods.length);

  const currentSettledPage = safePage(settledPage, settledPeriods.length);

  const visibleOpenPeriods = openPeriods.slice(
    currentOpenPage * PAGE_SIZE,
    (currentOpenPage + 1) * PAGE_SIZE,
  );

  const visibleSettledPeriods = settledPeriods.slice(
    currentSettledPage * PAGE_SIZE,
    (currentSettledPage + 1) * PAGE_SIZE,
  );

  function refreshPage() {
    startRefresh(() => {
      router.refresh();
    });
  }

  async function changePeriod(period: SettlementPeriod) {
    if (busy) {
      return;
    }

    setPendingId(period.id);
    setError("");
    setNotice("");

    const markSettled = period.settledAt === null;

    try {
      const result = await setCarPeriodSettled(
        organizationId,
        period.id,
        markSettled,
      );

      if (!result.success) {
        setError(result.error);

        if (result.refreshRequired) {
          refreshPage();
        }

        return;
      }

      setOpenPage(0);
      setSettledPage(0);

      setNotice(
        markSettled
          ? "De tankperiode is als afgerekend gemarkeerd."
          : "De tankperiode is opnieuw geopend.",
      );

      refreshPage();
    } catch {
      setError("De wijziging kon niet worden opgeslagen. Probeer opnieuw.");
    } finally {
      setPendingId(null);
    }
  }

  async function finishStatement() {
    if (busy || completePeriods.length === 0) {
      return;
    }

    setPendingId("all");
    setError("");
    setNotice("");

    const count = completePeriods.length;

    const expectedSnapshot = getCarSettlementSnapshot(settlement.periods);

    try {
      const result = await settleCarStatement(organizationId, expectedSnapshot);

      if (!result.success) {
        setError(result.error);

        if (result.refreshRequired) {
          refreshPage();
        }

        return;
      }

      setOpenPage(0);
      setSettledPage(0);

      setNotice(
        count === 1
          ? "De afrekening is afgerond. Eén tankperiode is als afgerekend gemarkeerd."
          : `De afrekening is afgerond. ${count} tankperiodes zijn als afgerekend gemarkeerd.`,
      );

      refreshPage();
    } catch {
      setError("De afrekening kon niet worden afgerond. Probeer opnieuw.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>Afrekening</h2>

        <span className={styles.completeBadge}>
          {settlement.completePeriodCount}
          {" volledige open "}
          {settlement.completePeriodCount === 1
            ? "tankperiode"
            : "tankperiodes"}
        </span>
      </div>

      <p className={styles.description}>
        Wie betaalt wie, op basis van alle volledige tankperiodes die nog niet
        afgerekend zijn.
      </p>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {settlement.incompletePeriodCount > 0 && (
        <div className={styles.warning}>
          <h3 className={styles.smallHeading}>Een deel is nog onvolledig</h3>

          <p>
            {settlement.incompletePeriodCount}{" "}
            {settlement.incompletePeriodCount === 1
              ? "tankperiode telt"
              : "tankperiodes tellen"}{" "}
            nog niet mee door ontbrekende of overlappende ritten. Bekijk die
            onder ‘Open tankperiodes’.
          </p>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className={styles.paymentSection}>
          <h3>Jij betaalt</h3>

          <p className={styles.bigAmount}>{money(totalToPay)}</p>

          <p className={styles.detail}>
            Verdeeld over {outgoing.length}{" "}
            {outgoing.length === 1 ? "persoon" : "personen"}
          </p>

          <div className={styles.transfers}>
            {outgoing.map((transfer) => (
              <TransferCard
                key={transfer.toUserId}
                transfer={transfer}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        </div>
      )}

      {incoming.length > 0 && (
        <div className={styles.paymentSection}>
          <h3>Jij krijgt terug</h3>

          <p className={`${styles.bigAmount} ${styles.receives}`}>
            {money(totalToReceive)}
          </p>

          <p className={styles.detail}>
            Van {incoming.length}{" "}
            {incoming.length === 1 ? "persoon" : "personen"}
          </p>

          <div className={styles.transfers}>
            {incoming.map((transfer) => (
              <TransferCard
                key={transfer.fromUserId}
                transfer={transfer}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        </div>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className={styles.empty}>
          {settlement.completePeriodCount > 0
            ? "Voor jou zijn er geen betalingen uit de volledige open tankperiodes."
            : openPeriods.length > 0
              ? "Er zijn nog geen volledige open tankperiodes om betalingen te berekenen."
              : settledPeriods.length > 0
                ? "Alle geregistreerde tankperiodes zijn afgerekend."
                : "De eerste afrekening verschijnt na de volgende volle tankbeurt."}
        </p>
      )}

      <details className={styles.sectionFold}>
        <summary>
          <h3>Wie betaalt wie in de groep?</h3>

          <span className={styles.count}>{settlement.transfers.length}</span>
        </summary>

        {settlement.transfers.length === 0 ? (
          <p className={styles.empty}>
            Geen openstaande betalingen uit volledige tankperiodes.
          </p>
        ) : (
          <div className={styles.transfers}>
            {settlement.transfers.map((transfer) => (
              <TransferCard
                key={`${transfer.fromUserId}-${transfer.toUserId}`}
                transfer={transfer}
                currentUserId={currentUserId}
                group
              />
            ))}
          </div>
        )}
      </details>

      {isOwner && firstComplete && lastComplete && (
        <div className={styles.periodActions}>
          <p className={styles.detail}>
            <strong>Alle betalingen in dit overzicht uitgevoerd?</strong>
            <br />
            Rond samen{" "}
            {completePeriods.length === 1
              ? "deze volledige tankperiode"
              : `deze ${completePeriods.length} volledige tankperiodes`}
            {" af: "}
            {formatDate(firstComplete.startDate)}
            {" tot "}
            {formatDate(lastComplete.endDate)}.
            {settlement.incompletePeriodCount > 0
              ? " Onvolledige periodes blijven open."
              : ""}
          </p>

          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void finishStatement()}
          >
            {pendingId === "all"
              ? "Afrekening afronden…"
              : "Alles afbetaald — afrekening afronden"}
          </button>
        </div>
      )}

      <details className={styles.sectionFold}>
        <summary>
          <h3>Open tankperiodes</h3>

          <span className={styles.count}>{openPeriods.length}</span>
        </summary>

        {openPeriods.length === 0 ? (
          <p className={styles.empty}>Geen open tankperiodes.</p>
        ) : (
          <>
            <p className={styles.foldDescription}>
              Bekijk de kilometerverdeling per periode.
              {isOwner
                ? " Als eigenaar kun je ook een afzonderlijke volledige periode als afgerekend markeren."
                : ""}
            </p>

            <div className={styles.periods}>
              {visibleOpenPeriods.map((period) => (
                <PeriodCard
                  key={period.id}
                  period={period}
                  isOwner={isOwner}
                  busy={busy}
                  pendingId={pendingId}
                  onChange={changePeriod}
                />
              ))}
            </div>

            <Pagination
              page={currentOpenPage}
              total={openPeriods.length}
              onChange={setOpenPage}
            />
          </>
        )}
      </details>

      <details className={styles.sectionFold}>
        <summary>
          <h3>Afgerekende tankperiodes</h3>

          <span className={styles.count}>{settledPeriods.length}</span>
        </summary>

        {settledPeriods.length === 0 ? (
          <p className={styles.empty}>
            Nog geen tankperiodes als afgerekend gemarkeerd.
          </p>
        ) : (
          <>
            <p className={styles.foldDescription}>
              Deze periodes blijven bewaard en tellen niet mee voor de
              openstaande betalingen.
            </p>

            <div className={styles.periods}>
              {visibleSettledPeriods.map((period) => (
                <PeriodCard
                  key={period.id}
                  period={period}
                  isOwner={isOwner}
                  busy={busy}
                  pendingId={pendingId}
                  onChange={changePeriod}
                />
              ))}
            </div>

            <Pagination
              page={currentSettledPage}
              total={settledPeriods.length}
              onChange={setSettledPage}
            />
          </>
        )}
      </details>

      <p className={styles.note}>
        Wederzijdse schulden worden per tweetal verrekend. Kilometers na de
        laatste volle tank wachten op de volgende tankbeurt.
      </p>
    </section>
  );
}
