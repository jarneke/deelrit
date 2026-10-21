"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCarPeriodSettled } from "@/actions/car-settlement";
import { finishCarStatement } from "@/actions/car-settlement-view";
import type { SettlementPeriod } from "@/lib/car-settlement";
import type { SettlementOverview } from "@/lib/car-settlement-view-types";
import ActionButton from "./action-button";
import CarSettlementTransfer from "./car-settlement-transfer";
import CarSettlementPeriods from "./car-settlement-periods";
import styles from "./car-settlement.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  overview: SettlementOverview;
};

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

export default function CarSettlement({
  organizationId,
  currentUserId,
  isOwner,
  overview,
}: Props) {
  const router = useRouter();

  const [openPeriods, setOpenPeriods] = useState(false);
  const [settledPeriods, setSettledPeriods] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const busy = pendingId !== null || refreshing;

  const outgoing = overview.transfers.filter(
    (transfer) => transfer.fromUserId === currentUserId,
  );

  const incoming = overview.transfers.filter(
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

  function refreshPage() {
    startRefresh(() => {
      router.refresh();
    });
  }

  async function changePeriod(period: SettlementPeriod) {
    if (busy) return;

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
        if (result.refreshRequired) refreshPage();
        return;
      }

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
    if (busy || overview.completePeriodCount === 0) return;

    setPendingId("all");
    setError("");
    setNotice("");

    const count = overview.completePeriodCount;

    try {
      const result = await finishCarStatement(
        organizationId,
        overview.expectedSnapshot,
      );

      if (!result.success) {
        setError(result.error);
        if (result.refreshRequired) refreshPage();
        return;
      }

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
          {overview.completePeriodCount}
          {" volledige open "}
          {overview.completePeriodCount === 1 ? "tankperiode" : "tankperiodes"}
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

      {overview.incompletePeriodCount > 0 && (
        <div className={styles.warning}>
          <h3 className={styles.smallHeading}>Een deel is nog onvolledig</h3>

          <p>
            {overview.incompletePeriodCount}{" "}
            {overview.incompletePeriodCount === 1
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
              <CarSettlementTransfer
                key={`${overview.revision}:${transfer.toUserId}`}
                organizationId={organizationId}
                currentUserId={currentUserId}
                transfer={transfer}
                revision={overview.revision}
                busy={busy}
                onRefresh={refreshPage}
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
              <CarSettlementTransfer
                key={`${overview.revision}:${transfer.fromUserId}`}
                organizationId={organizationId}
                currentUserId={currentUserId}
                transfer={transfer}
                revision={overview.revision}
                busy={busy}
                onRefresh={refreshPage}
              />
            ))}
          </div>
        </div>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className={styles.empty}>
          {overview.completePeriodCount > 0
            ? "Voor jou zijn er geen betalingen uit de volledige open tankperiodes."
            : overview.openPeriodCount > 0
              ? "Er zijn nog geen volledige open tankperiodes om betalingen te berekenen."
              : overview.settledPeriodCount > 0
                ? "Alle geregistreerde tankperiodes zijn afgerekend."
                : "De eerste afrekening verschijnt na de volgende volle tankbeurt."}
        </p>
      )}

      <details className={styles.sectionFold}>
        <summary>
          <h3>Wie betaalt wie in de groep?</h3>

          <span className={styles.count}>{overview.transfers.length}</span>
        </summary>

        {overview.transfers.length === 0 ? (
          <p className={styles.empty}>
            Geen openstaande betalingen uit volledige tankperiodes.
          </p>
        ) : (
          <div className={styles.transfers}>
            {overview.transfers.map((transfer) => (
              <CarSettlementTransfer
                key={`${overview.revision}:${transfer.fromUserId}:${transfer.toUserId}`}
                organizationId={organizationId}
                currentUserId={currentUserId}
                transfer={transfer}
                revision={overview.revision}
                busy={busy}
                onRefresh={refreshPage}
                group
              />
            ))}
          </div>
        )}
      </details>

      {isOwner && overview.firstCompleteDate && overview.lastCompleteDate && (
        <div className={styles.periodActions}>
          <p className={styles.detail}>
            <strong>Alle betalingen in dit overzicht uitgevoerd?</strong>
            <br />
            Rond samen{" "}
            {overview.completePeriodCount === 1
              ? "deze volledige tankperiode"
              : `deze ${overview.completePeriodCount} volledige tankperiodes`}
            {" af: "}
            {formatDate(overview.firstCompleteDate)}
            {" tot "}
            {formatDate(overview.lastCompleteDate)}.
            {overview.incompletePeriodCount > 0
              ? " Onvolledige periodes blijven open."
              : ""}
          </p>

          <ActionButton
            icon="check"
            loading={pendingId === "all"}
            className={styles.secondary}
            disabled={busy}
            onClick={() => void finishStatement()}
          >
            {pendingId === "all"
              ? "Afrekening afronden…"
              : "Alles afbetaald — afrekening afronden"}
          </ActionButton>
        </div>
      )}

      <CarSettlementPeriods
        key={`open:${overview.revision}`}
        organizationId={organizationId}
        settled={false}
        total={overview.openPeriodCount}
        revision={overview.revision}
        isOwner={isOwner}
        busy={busy}
        pendingId={pendingId}
        open={openPeriods}
        onOpenChange={setOpenPeriods}
        onChange={changePeriod}
        onRefresh={refreshPage}
      />

      <CarSettlementPeriods
        key={`settled:${overview.revision}`}
        organizationId={organizationId}
        settled
        total={overview.settledPeriodCount}
        revision={overview.revision}
        isOwner={isOwner}
        busy={busy}
        pendingId={pendingId}
        open={settledPeriods}
        onOpenChange={setSettledPeriods}
        onChange={changePeriod}
        onRefresh={refreshPage}
      />

      <p className={styles.note}>
        Wederzijdse schulden worden per tweetal verrekend. Kilometers na de
        laatste volle tank wachten op de volgende tankbeurt.
      </p>
    </section>
  );
}
