"use client";

import { useEffect, useState } from "react";
import { getCarTripHistoryPage } from "@/actions/car-history";
import type { HistoryPage, TripHistoryItem } from "@/lib/car-history-types";
import {
  formatTripPayers,
  getTripPayerId,
  getTripPayers,
} from "@/lib/car-trip-payers";
import ActionButton, { ActionGroup } from "./action-button";
import AppIcon from "./app-icon";
import UserAvatar from "./user-avatar";
import styles from "./car-history.module.css";

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
const shares = ["", "100%", "50%", "1/3", "25%", "20%"];

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
        if (!cancelled) setLoading(false);
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
      getTripPayers(trip).some(
        (payer) => payer.kind === "member" && payer.userId === currentUserId,
      )
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
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className={styles.summary}>
        <span className={styles.summaryIcon} aria-hidden="true">
          <AppIcon name="car" size={20} />
        </span>

        <span className={styles.summaryText}>
          <span className={styles.summaryTitle}>
            Rithistoriek
            <span className={styles.count}>
              {numbers.format(data?.total ?? total)}
            </span>
          </span>

          <span className={styles.summaryMeta}>
            {numbers.format(totalDistance)} km geregistreerd
          </span>
        </span>
      </summary>

      {open ? (
        <div className={styles.content} aria-busy={loading}>
          <p className={styles.description}>
            Nieuwste kilometerstanden eerst. Voor ritten in een afgerekende
            periode moet een eigenaar die periode eerst opnieuw openen.
          </p>

          {loading ? (
            <div className={styles.feedback} role="status">
              Rithistoriek laden…
            </div>
          ) : error ? (
            <div className={styles.feedback}>
              <p role="alert" className={styles.error}>
                {error}
              </p>

              <ActionButton
                icon="undo"
                variant="secondary"
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
            <div className={styles.feedback}>
              Nog geen ritten geregistreerd.
            </div>
          ) : (
            <>
              <ul className={styles.list}>
                {data.items.map((trip) => {
                  const payers = getTripPayers(trip);
                  const payerNames = formatTripPayers(trip);
                  const shared = payers.length > 1;
                  const firstPayer = payers[0];

                  return (
                    <li key={trip.id} className={styles.row}>
                      <div className={styles.identity}>
                        <span className={styles.avatar} aria-hidden="true">
                          {shared ? (
                            <AppIcon name="users" size={18} />
                          ) : (
                            <UserAvatar
                              name={firstPayer.name}
                              userId={
                                firstPayer.kind === "member"
                                  ? firstPayer.userId
                                  : null
                              }
                            />
                          )}
                        </span>

                        <div className={styles.info}>
                          <p className={styles.title}>
                            {shared ? "Gedeelde rit" : payers[0].name}
                          </p>

                          {shared ? (
                            <>
                              <ul
                                className={styles.payers}
                                aria-label="Betalers van deze rit"
                              >
                                {payers.map((payer) => (
                                  <li
                                    key={getTripPayerId(payer)}
                                    className={styles.payer}
                                  >
                                    <span>{payer.name}</span>
                                    {payer.kind === "guest" ? (
                                      <span className={styles.guest}>gast</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>

                              <p className={styles.detail}>
                                Ieder {shares[payers.length]} van de ritkost
                              </p>
                            </>
                          ) : payers[0].kind === "guest" ? (
                            <p className={styles.detail}>Gast zonder account</p>
                          ) : null}

                          <p className={styles.detail}>
                            {formatTripMoment(trip)}
                          </p>

                          <p
                            className={[styles.detail, styles.odometer].join(
                              " ",
                            )}
                          >
                            {numbers.format(trip.startOdometer)}
                            {" → "}
                            {numbers.format(trip.endOdometer)} km
                          </p>

                          {trip.description ? (
                            <p className={styles.note}>{trip.description}</p>
                          ) : null}

                          {trip.settledLocked ? (
                            <span className={styles.badge}>
                              <AppIcon name="shield" size={13} />
                              Periode afgerekend
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className={styles.side}>
                        <strong className={styles.value}>
                          {numbers.format(
                            trip.endOdometer - trip.startOdometer,
                          )}{" "}
                          km
                        </strong>

                        {canManage(trip) && !trip.settledLocked ? (
                          <ActionGroup>
                            <ActionButton
                              icon="edit"
                              iconOnly
                              label={"Rit van " + payerNames + " bewerken"}
                              variant="glass"
                              disabled={busy}
                              onClick={() => onEdit(trip)}
                            />

                            <ActionButton
                              icon="trash"
                              iconOnly
                              danger
                              label={"Rit van " + payerNames + " verwijderen"}
                              variant="ghost"
                              disabled={busy}
                              onClick={() => onDelete(trip)}
                            />
                          </ActionGroup>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {pageCount > 1 ? (
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
                      iconOnly
                      label="Vorige pagina met ritten"
                      variant="secondary"
                      disabled={busy || data.page === 0}
                      onClick={() => changePage(data.page - 1)}
                    />

                    <span>
                      {data.page + 1} / {pageCount}
                    </span>

                    <ActionButton
                      icon="arrow-right"
                      iconOnly
                      label="Volgende pagina met ritten"
                      variant="secondary"
                      disabled={busy || data.page === pageCount - 1}
                      onClick={() => changePage(data.page + 1)}
                    />
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}
