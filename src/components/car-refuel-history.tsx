"use client";

import { useEffect, useState } from "react";
import { getCarRefuelHistoryPage } from "@/actions/car-history";
import type {
  HistoryPage,
  RefuelHistoryEntry,
  RefuelHistoryItem,
} from "@/lib/car-history-types";
import ActionButton, { ActionGroup } from "./action-button";
import styles from "./car-trips.module.css";

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
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function CarRefuelHistory({
  organizationId,
  currentUserId,
  isOwner,
  total,
  open,
  busy,
  onOpenChange,
  onEdit,
  onDelete,
}: Props) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<HistoryPage<RefuelHistoryEntry> | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await getCarRefuelHistoryPage(organizationId, page);

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          return;
        }

        setData(result.data);
      } catch {
        if (!cancelled) {
          setError(
            "De tankgeschiedenis kon niet worden geladen. Probeer opnieuw.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, page, retry]);

  function canManage(refuel: RefuelHistoryItem) {
    return (
      isOwner ||
      refuel.createdBy === currentUserId ||
      refuel.paidBy === currentUserId
    );
  }

  function changePage(nextPage: number) {
    if (busy || loading) return;

    setLoading(true);
    setError("");
    setPage(nextPage);
  }

  const pageCount = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  const firstIndex = data ? data.page * data.pageSize : 0;

  return (
    <details
      className={styles.history}
      open={open}
      onToggle={(event) => {
        onOpenChange(event.currentTarget.open);
      }}
    >
      <summary className={styles.historySummary}>
        <span className={styles.historyHeading}>
          <span>Tankgeschiedenis</span>
          <span className={styles.count}>{data?.total ?? total}</span>
        </span>

        <span className={styles.historyMeta}>Volle tankbeurten</span>
      </summary>

      {open && (
        <>
          <p className={styles.historyDescription}>
            Nieuwste kilometerstanden eerst. Afgerekende periodes moet een
            eigenaar eerst opnieuw openen om bijbehorende tankbeurten te
            wijzigen of te verwijderen.
          </p>

          {loading ? (
            <p className={styles.empty} role="status">
              Tankgeschiedenis laden…
            </p>
          ) : error ? (
            <div>
              <p role="alert" className={styles.error}>
                {error}
              </p>

              <ActionButton
                icon="undo"
                className={styles.secondary}
                disabled={busy}
                onClick={() => {
                  setLoading(true);
                  setRetry((value) => value + 1);
                }}
              >
                Opnieuw proberen
              </ActionButton>
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className={styles.empty}>Nog geen tankbeurten geregistreerd.</p>
          ) : (
            <>
              <ul className={styles.list}>
                {data.items.map((entry) => {
                  if (entry.kind === "startpoint") {
                    return (
                      <li key="startpoint" className={styles.trip}>
                        <div className={styles.tripInfo}>
                          <p className={styles.driver}>
                            {formatDate(entry.startpoint.tankDate)}
                          </p>

                          <p className={styles.detail}>
                            {numbers.format(entry.startpoint.odometer)} km
                          </p>

                          <span className={styles.settledBadge}>
                            Startpunt · volle tank
                          </span>

                          <p className={styles.detail}>
                            Begin van de kilometerregistratie. Deze tank telt
                            niet mee in de afrekening.
                          </p>
                        </div>
                      </li>
                    );
                  }

                  const { refuel } = entry;
                  const manageable = canManage(refuel);

                  return (
                    <li key={refuel.id} className={styles.trip}>
                      <div className={styles.tripInfo}>
                        <p className={styles.driver}>
                          {formatDate(refuel.tankDate)}
                        </p>

                        <p className={styles.detail}>
                          {numbers.format(refuel.odometer)} km
                        </p>

                        <p className={styles.detail}>
                          Betaald door {refuel.payerName}
                        </p>

                        {refuel.settledAt && (
                          <span className={styles.settledBadge}>
                            Afgerekend
                          </span>
                        )}

                        {!refuel.settledAt &&
                          refuel.boundaryLocked &&
                          manageable && (
                            <p className={styles.detail}>
                              Verwijderen kan na het heropenen van de volgende
                              afgerekende periode.
                            </p>
                          )}
                      </div>

                      <div className={styles.wideField}>
                        <strong className={styles.tripDistance}>
                          {euros.format(refuel.amountCents / 100)}
                        </strong>

                        {manageable && !refuel.settledAt && (
                          <ActionGroup>
                            <ActionButton
                              icon="edit"
                              iconOnly
                              label={`Tankbeurt van ${formatDate(refuel.tankDate)} bewerken`}
                              className={styles.secondary}
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
                                  : `Tankbeurt van ${formatDate(refuel.tankDate)} verwijderen`
                              }
                              className={styles.secondary}
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

              {pageCount > 1 && (
                <nav
                  className={styles.pagination}
                  aria-label="Tankbeurten pagineren"
                >
                  <span aria-live="polite">
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

                    <span>
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
