"use client";

import { useEffect, useState } from "react";
import { getCarTripHistoryPage } from "@/actions/car-history";
import type { HistoryPage, TripHistoryItem } from "@/lib/car-history-types";
import ActionButton, { ActionGroup } from "./action-button";
import styles from "./car-trips.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  total: number;
  totalDistance: number;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (trip: TripHistoryItem) => void;
  onDelete: (trip: TripHistoryItem) => void;
};

const numbers = new Intl.NumberFormat("nl-BE");

function formatTripMoment(trip: TripHistoryItem) {
  if (!trip.endedAt) {
    const date = new Intl.DateTimeFormat("nl-BE", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${trip.tripDate}T00:00:00Z`));

    return `${date} · tijd onbekend`;
  }

  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(trip.endedAt));
}

export default function CarTripHistory({
  organizationId,
  currentUserId,
  isOwner,
  total,
  totalDistance,
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
  const [data, setData] = useState<HistoryPage<TripHistoryItem> | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await getCarTripHistoryPage(organizationId, page);

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          return;
        }

        setData(result.data);
      } catch {
        if (!cancelled) {
          setError(
            "De ritgeschiedenis kon niet worden geladen. Probeer opnieuw.",
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

  function canManage(trip: TripHistoryItem) {
    return (
      isOwner ||
      trip.createdBy === currentUserId ||
      trip.driverId === currentUserId
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
          <span>Rittengeschiedenis</span>
          <span className={styles.count}>{data?.total ?? total}</span>
        </span>

        <span className={styles.historyMeta}>
          {numbers.format(totalDistance)} km geregistreerd
        </span>
      </summary>

      {open && (
        <>
          <p className={styles.historyDescription}>
            Nieuwste kilometerstanden eerst. Voor ritten in een afgerekende
            periode moet een eigenaar die periode eerst opnieuw openen.
          </p>

          {loading ? (
            <p className={styles.empty} role="status">
              Ritgeschiedenis laden…
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
            <p className={styles.empty}>Nog geen ritten geregistreerd.</p>
          ) : (
            <>
              <ul className={styles.list}>
                {data.items.map((trip) => (
                  <li key={trip.id} className={styles.trip}>
                    <div className={styles.tripInfo}>
                      <p className={styles.driver}>{trip.driverName}</p>

                      <p className={styles.detail}>{formatTripMoment(trip)}</p>

                      <p className={styles.detail}>
                        {numbers.format(trip.startOdometer)}
                        {" → "}
                        {numbers.format(trip.endOdometer)} km
                      </p>

                      {trip.description && (
                        <p className={styles.description}>{trip.description}</p>
                      )}

                      {trip.settledLocked && (
                        <span className={styles.settledBadge}>
                          Periode afgerekend
                        </span>
                      )}
                    </div>

                    <div className={styles.wideField}>
                      <strong className={styles.tripDistance}>
                        {numbers.format(trip.endOdometer - trip.startOdometer)}{" "}
                        km
                      </strong>

                      {canManage(trip) && !trip.settledLocked && (
                        <ActionGroup>
                          <ActionButton
                            icon="edit"
                            iconOnly
                            label={`Rit van ${trip.driverName} bewerken`}
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() => onEdit(trip)}
                          />

                          <ActionButton
                            icon="trash"
                            iconOnly
                            danger
                            label={`Rit van ${trip.driverName} verwijderen`}
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() => onDelete(trip)}
                          />
                        </ActionGroup>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {pageCount > 1 && (
                <nav
                  className={styles.pagination}
                  aria-label="Ritten pagineren"
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
