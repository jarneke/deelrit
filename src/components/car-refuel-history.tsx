"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchCarHistory } from "@/actions/car-history-browser";
import type { HistoryBrowserData } from "@/lib/car-history-browser-types";
import type { RefuelHistoryItem } from "@/lib/car-history-types";
import ActionButton, { ActionGroup } from "./action-button";
import AppIcon from "./app-icon";
import GlassSurface from "./glass-surface";
import UserAvatar from "./user-avatar";
import styles from "./car-history-preview.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  total: number;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (refuel: RefuelHistoryItem) => void;
  onDelete: (refuel: RefuelHistoryItem) => void;
};

const numbers = new Intl.NumberFormat("nl-BE");

const euros = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
});

function formatDate(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

export default function CarRefuelHistory({
  organizationId,
  currentUserId,
  isOwner,
  total,
  busy,
  onEdit,
  onDelete,
}: Props) {
  const [data, setData] = useState<HistoryBrowserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await searchCarHistory(organizationId, {
          kind: "refuels",
          sort: "date-desc",
          page: 1,
          pageSize: 5,
        });

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          return;
        }

        setData(result.data);
      } catch {
        if (!cancelled) {
          setError("De recente tankbeurten konden niet worden geladen.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [organizationId, retry]);

  function canManage(refuel: RefuelHistoryItem) {
    return (
      isOwner ||
      refuel.createdBy === currentUserId ||
      refuel.paidBy === currentUserId
    );
  }

  const historyHref =
    "/auto/" + encodeURIComponent(organizationId) + "/historiek?kind=refuels";

  return (
    <GlassSurface
      id="car-refuel-history"
      className={styles.preview}
      style={{ gridRow: 5 }}
      tabIndex={-1}
      aria-labelledby="car-refuel-history-heading"
    >
      <div className={styles.header}>
        <div>
          <h2 id="car-refuel-history-heading">Recente tankbeurten</h2>
          <p>
            {numbers.format(data?.total ?? Math.max(0, total - 1))}
            {" geregistreerde volle tankbeurten"}
          </p>
        </div>

        <AppIcon name="wallet" size={20} />
      </div>

      <div aria-busy={loading}>
        {loading ? (
          <p className={styles.feedback} role="status">
            Recente tankbeurten laden…
          </p>
        ) : error ? (
          <div className={styles.feedback}>
            <p role="alert">{error}</p>
            <ActionButton
              icon="undo"
              variant="secondary"
              disabled={busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              Opnieuw proberen
            </ActionButton>
          </div>
        ) : !data || data.refuels.length === 0 ? (
          <p className={styles.feedback}>Nog geen tankbeurten geregistreerd.</p>
        ) : (
          <ul className={styles.list}>
            {data.refuels.map((refuel) => {
              const manageable = canManage(refuel);

              return (
                <li key={refuel.id} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.avatar} aria-hidden="true">
                      <UserAvatar
                        name={refuel.payerName}
                        userId={refuel.paidBy}
                      />
                    </span>

                    <div className={styles.info}>
                      <p className={styles.name}>{refuel.payerName}</p>
                      <p>{formatDate(refuel.tankDate)}</p>
                      <p className={styles.odometer}>
                        {numbers.format(refuel.odometer)} km
                      </p>

                      {refuel.settledAt && (
                        <span className={styles.badge}>Afgerekend</span>
                      )}

                      {!refuel.settledAt && refuel.boundaryLocked && (
                        <p className={styles.description}>
                          Datum en stand liggen vast door de volgende
                          afgerekende periode.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className={styles.side}>
                    <strong>{euros.format(refuel.amountCents / 100)}</strong>

                    {manageable && !refuel.settledAt && (
                      <ActionGroup>
                        <ActionButton
                          icon="edit"
                          iconOnly
                          label={
                            "Tankbeurt van " +
                            formatDate(refuel.tankDate) +
                            " bewerken"
                          }
                          variant="glass"
                          disabled={busy}
                          onClick={() => onEdit(refuel)}
                        />

                        <ActionButton
                          icon="trash"
                          iconOnly
                          danger
                          label={
                            refuel.boundaryLocked
                              ? "Verwijderen geblokkeerd: de volgende periode is afgerekend"
                              : "Tankbeurt van " +
                                formatDate(refuel.tankDate) +
                                " verwijderen"
                          }
                          variant="ghost"
                          disabled={busy || refuel.boundaryLocked}
                          onClick={() => onDelete(refuel)}
                        />
                      </ActionGroup>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link href={historyHref} className={styles.allLink}>
        <span>Volledige tankhistoriek</span>
        <AppIcon name="arrow-right" size={18} />
      </Link>
    </GlassSurface>
  );
}
