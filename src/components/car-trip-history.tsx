"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchCarHistory } from "@/actions/car-history-browser";
import type { HistoryBrowserData } from "@/lib/car-history-browser-types";
import type { TripHistoryItem } from "@/lib/car-history-types";
import { formatTripPayers, getTripPayers } from "@/lib/car-trip-payers";
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
  totalDistance: number;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (trip: TripHistoryItem) => void;
  onDelete: (trip: TripHistoryItem) => void;
};

const numbers = new Intl.NumberFormat("nl-BE");

function formatMoment(trip: TripHistoryItem) {
  const date = new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(trip.tripDate + "T12:00:00Z"));

  if (!trip.endedAt) return date + " · tijd onbekend";

  const time = new Intl.DateTimeFormat("nl-BE", {
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(trip.endedAt));

  return date + " · " + time;
}

export default function CarTripHistory({
  organizationId,
  currentUserId,
  isOwner,
  total,
  totalDistance,
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
          kind: "trips",
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
          setError("De recente ritten konden niet worden geladen.");
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

  function canManage(trip: TripHistoryItem) {
    return (
      isOwner ||
      trip.createdBy === currentUserId ||
      getTripPayers(trip).some(
        (payer) => payer.kind === "member" && payer.userId === currentUserId,
      )
    );
  }

  const historyHref =
    "/auto/" + encodeURIComponent(organizationId) + "/historiek?kind=trips";

  return (
    <GlassSurface
      id="car-trip-history"
      className={styles.preview}
      style={{ gridRow: 4 }}
      tabIndex={-1}
      aria-labelledby="car-trip-history-heading"
    >
      <div className={styles.header}>
        <div>
          <h2 id="car-trip-history-heading">Recente ritten</h2>
          <p>
            {numbers.format(data?.total ?? total)} ritten
            {" · "}
            {numbers.format(totalDistance)} km geregistreerd
          </p>
        </div>

        <AppIcon name="car" size={20} />
      </div>

      <div aria-busy={loading}>
        {loading ? (
          <p className={styles.feedback} role="status">
            Recente ritten laden…
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
        ) : !data || data.trips.length === 0 ? (
          <p className={styles.feedback}>Nog geen ritten geregistreerd.</p>
        ) : (
          <ul className={styles.list}>
            {data.trips.map((trip) => {
              const payers = getTripPayers(trip);
              const payer = payers[0];
              const shared = payers.length > 1;
              const names = formatTripPayers(trip);

              return (
                <li key={trip.id} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.avatar} aria-hidden="true">
                      {shared ? (
                        <AppIcon name="users" size={18} />
                      ) : (
                        <UserAvatar
                          name={payer.name}
                          userId={payer.kind === "member" ? payer.userId : null}
                        />
                      )}
                    </span>

                    <div className={styles.info}>
                      <p className={styles.name}>{names}</p>
                      <p>{formatMoment(trip)}</p>
                      <p className={styles.odometer}>
                        {numbers.format(trip.startOdometer)}
                        {" → "}
                        {numbers.format(trip.endOdometer)} km
                      </p>

                      {trip.description && (
                        <p className={styles.description}>{trip.description}</p>
                      )}

                      {trip.settledLocked && (
                        <span className={styles.badge}>Afgerekend</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.side}>
                    <strong>
                      {numbers.format(trip.endOdometer - trip.startOdometer)} km
                    </strong>

                    {canManage(trip) && !trip.settledLocked && (
                      <ActionGroup>
                        <ActionButton
                          icon="edit"
                          iconOnly
                          label={"Rit van " + names + " bewerken"}
                          variant="glass"
                          disabled={busy}
                          onClick={() => onEdit(trip)}
                        />

                        <ActionButton
                          icon="trash"
                          iconOnly
                          danger
                          label={"Rit van " + names + " verwijderen"}
                          variant="ghost"
                          disabled={busy}
                          onClick={() => onDelete(trip)}
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
        <span>Volledige rithistoriek</span>
        <AppIcon name="arrow-right" size={18} />
      </Link>
    </GlassSurface>
  );
}
