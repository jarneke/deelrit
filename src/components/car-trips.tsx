"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createCarTrip, updateCarTrip } from "@/actions/car-trips";
import { deleteCarTrip } from "@/actions/delete-car-trip";
import ActionButton, { ActionGroup } from "./action-button";
import styles from "./car-trips.module.css";

type Driver = {
  userId: string;
  name: string;
};

type Trip = {
  id: string;
  driverId: string;
  driverName: string;
  createdBy: string;
  version: string;
  tripDate: string;
  endedAt: string | null;
  startOdometer: number;
  endOdometer: number;
  description: string;
};

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  startOdometer: number;
  startDate: string;
  today: string;
  drivers: Driver[];
  trips: Trip[];
  refuels: {
    odometer: number;
    settledAt: string | null;
  }[];
};

const PAGE_SIZE = 10;
const numbers = new Intl.NumberFormat("nl-BE");

function formatDate(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTripMoment(trip: Trip) {
  if (!trip.endedAt) {
    return `${formatDate(trip.tripDate)} · tijd onbekend`;
  }

  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(trip.endedAt));
}

function brusselsMoment(date = new Date()) {
  return {
    date: new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Brussels",
    }).format(date),

    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date),
  };
}

export default function CarTrips({
  organizationId,
  currentUserId,
  isOwner,
  startOdometer,
  startDate,
  today,
  drivers,
  trips,
  refuels,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [deletingTrip, setDeletingTrip] = useState<Trip | null>(null);

  const [driverId, setDriverId] = useState(currentUserId);
  const [tripDate, setTripDate] = useState(today);
  const [endTime, setEndTime] = useState("");
  const [dateLimit, setDateLimit] = useState(today);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const busy = saving || refreshing;
  const interactionOpen = showForm || deletingTrip !== null;

  useEffect(() => {
    if (showForm) {
      formRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
  }, [showForm]);

  useEffect(() => {
    if (deletingTrip) {
      deleteRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
  }, [deletingTrip]);

  const orderedTrips = [...trips].sort(
    (a, b) =>
      a.startOdometer - b.startOdometer || a.endOdometer - b.endOdometer,
  );

  const latestTrip = orderedTrips[orderedTrips.length - 1];

  const latestOdometer = latestTrip?.endOdometer ?? startOdometer;

  const totalDistance = orderedTrips.reduce(
    (total, trip) => total + trip.endOdometer - trip.startOdometer,
    0,
  );

  const settledRanges: {
    start: number;
    end: number;
  }[] = [];

  let previousTank = startOdometer;

  for (const refuel of [...refuels].sort((a, b) => a.odometer - b.odometer)) {
    if (refuel.settledAt) {
      settledRanges.push({
        start: previousTank,
        end: refuel.odometer,
      });
    }

    previousTank = refuel.odometer;
  }

  function isLocked(trip: Trip) {
    return settledRanges.some(
      (range) =>
        trip.startOdometer < range.end && trip.endOdometer > range.start,
    );
  }

  function canEdit(trip: Trip) {
    return (
      isOwner ||
      trip.createdBy === currentUserId ||
      trip.driverId === currentUserId
    );
  }

  const gaps: {
    start: number;
    end: number;
  }[] = [];

  let previousEnd = startOdometer;

  for (const trip of orderedTrips) {
    if (trip.startOdometer > previousEnd) {
      gaps.push({
        start: previousEnd,
        end: trip.startOdometer,
      });
    }

    previousEnd = Math.max(previousEnd, trip.endOdometer);
  }

  const missingDistance = gaps.reduce(
    (total, gap) => total + gap.end - gap.start,
    0,
  );

  const newestFirst = [...orderedTrips].reverse();
  const pageCount = Math.max(1, Math.ceil(newestFirst.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstIndex = currentPage * PAGE_SIZE;

  const visibleTrips = newestFirst.slice(firstIndex, firstIndex + PAGE_SIZE);

  const startNumber = start.trim() ? Number(start) : null;
  const endNumber = end.trim() ? Number(end) : null;

  const distance =
    startNumber !== null && endNumber !== null ? endNumber - startNumber : null;

  const incomingGap =
    !editingTrip &&
    startNumber !== null &&
    Number.isInteger(startNumber) &&
    startNumber > latestOdometer
      ? startNumber - latestOdometer
      : 0;

  const referenceTrip = editingTrip ?? latestTrip;

  const formerDriver =
    editingTrip &&
    !drivers.some((driver) => driver.userId === editingTrip.driverId)
      ? editingTrip
      : null;

  function refreshPage() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function openCreateForm() {
    const current = brusselsMoment();

    setEditingTrip(null);
    setDriverId(currentUserId);
    setTripDate(current.date);
    setEndTime(current.time);
    setDateLimit(current.date);
    setStart("");
    setEnd("");
    setDescription("");
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditForm(trip: Trip) {
    if (busy || interactionOpen || !canEdit(trip) || isLocked(trip)) {
      return;
    }

    setEditingTrip(trip);
    setDriverId(trip.driverId);
    setTripDate(trip.tripDate);
    setEndTime(trip.endedAt ? brusselsMoment(new Date(trip.endedAt)).time : "");
    setDateLimit(brusselsMoment().date);
    setStart(String(trip.startOdometer));
    setEnd(String(trip.endOdometer));
    setDescription(trip.description);
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingTrip(null);
    setError("");
  }

  function openDeleteForm(trip: Trip) {
    if (busy || interactionOpen || !canEdit(trip) || isLocked(trip)) {
      return;
    }

    setDeletingTrip(trip);
    setError("");
    setNotice("");
  }

  async function confirmDelete() {
    if (busy || !deletingTrip) return;

    setError("");
    setNotice("");
    setSaving(true);

    try {
      const result = await deleteCarTrip({
        organizationId,
        tripId: deletingTrip.id,
        expectedVersion: deletingTrip.version,
      });

      if (!result.success) {
        setError(result.error);

        if (result.refreshRequired) {
          setDeletingTrip(null);
          refreshPage();
        }

        return;
      }

      setDeletingTrip(null);
      setNotice("Rit verwijderd.");
      refreshPage();
    } catch {
      setError("Verwijderen is niet gelukt. Probeer opnieuw.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");
    setNotice("");

    if (!start.trim() || !end.trim()) {
      setError("Vul de beginstand en eindstand in.");
      return;
    }

    setSaving(true);

    try {
      const input = {
        organizationId,
        driverId,
        tripDate,
        endTime,
        startOdometer: Number(start),
        endOdometer: Number(end),
        description,
      };

      const result = editingTrip
        ? await updateCarTrip({
            ...input,
            tripId: editingTrip.id,
            expectedVersion: editingTrip.version,
          })
        : await createCarTrip(input);

      if (!result.success) {
        setError(result.error);
        if (result.refreshRequired) refreshPage();
        return;
      }

      if (!editingTrip) setPage(0);

      setNotice(editingTrip ? "Rit bijgewerkt." : "Rit opgeslagen.");

      setShowForm(false);
      setEditingTrip(null);
      refreshPage();
    } catch {
      setError("Opslaan is niet gelukt. Probeer opnieuw.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>Ritten</h2>
          <p className={styles.subtitle}>
            Laatste geregistreerde stand:{" "}
            <strong>{numbers.format(latestOdometer)} km</strong>
          </p>
        </div>

        {!interactionOpen && (
          <ActionButton
            icon="plus"
            onClick={openCreateForm}
            className={styles.primary}
            disabled={busy}
          >
            Rit toevoegen
          </ActionButton>
        )}
      </div>

      {deletingTrip && (
        <div
          ref={deleteRef}
          className={styles.warning}
          role="region"
          aria-label="Rit verwijderen"
        >
          <div className={styles.wideField}>
            <h3>Deze rit definitief verwijderen?</h3>

            <p className={styles.description}>
              <strong>{deletingTrip.driverName}</strong>
              {" · "}
              {formatTripMoment(deletingTrip)}
              <br />
              {numbers.format(deletingTrip.startOdometer)}
              {" → "}
              {numbers.format(deletingTrip.endOdometer)}
              {" km"}
            </p>

            <p className={styles.detail}>
              De kilometerverdeling en afrekening worden opnieuw berekend.
              Ontbrekende kilometers worden daarna apart getoond.
            </p>

            <div className={styles.formActions}>
              <ActionButton
                icon="trash"
                loading={saving}
                className={styles.primary}
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {saving ? "Verwijderen…" : "Definitief verwijderen"}
              </ActionButton>

              <ActionButton
                icon="close"
                className={styles.secondary}
                disabled={busy}
                onClick={() => {
                  setDeletingTrip(null);
                  setError("");
                }}
              >
                Annuleren
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {!showForm && error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {showForm && (
        <form
          ref={formRef}
          onSubmit={submit}
          className={styles.form}
          aria-label={editingTrip ? "Rit bewerken" : "Rit toevoegen"}
        >
          <fieldset disabled={busy} className={styles.fields}>
            <div className={styles.previousTrip}>
              <p className={styles.contextLabel}>
                {editingTrip
                  ? "Rit bewerken"
                  : latestTrip
                    ? "Laatste geregistreerde rit"
                    : "Startpunt"}
              </p>

              {referenceTrip ? (
                <>
                  <p className={styles.contextName}>
                    {referenceTrip.driverName}
                    <span>
                      {" · "}
                      {formatTripMoment(referenceTrip)}
                    </span>
                  </p>

                  <p className={styles.contextDistance}>
                    {numbers.format(referenceTrip.startOdometer)}
                    {" → "}
                    {numbers.format(referenceTrip.endOdometer)}
                    {" km"}
                  </p>
                </>
              ) : (
                <p className={styles.contextName}>
                  Volle tank op {formatDate(startDate)}
                </p>
              )}

              {!editingTrip && (
                <div className={styles.contextBottom}>
                  <p>
                    Begon jouw rit op{" "}
                    <strong>{numbers.format(latestOdometer)} km</strong>?
                  </p>

                  <ActionButton
                    icon="check"
                    className={styles.secondary}
                    onClick={() => setStart(String(latestOdometer))}
                  >
                    Gebruik {numbers.format(latestOdometer)} km
                  </ActionButton>
                </div>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="trip-driver">Bestuurder</label>
              <select
                id="trip-driver"
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                required
              >
                {formerDriver && (
                  <option value={formerDriver.driverId}>
                    {formerDriver.driverName}
                    {" · geen groepslid meer"}
                  </option>
                )}

                {drivers.map((driver) => (
                  <option key={driver.userId} value={driver.userId}>
                    {driver.name}
                    {driver.userId === currentUserId ? " · jij" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="trip-date">Datum einde rit</label>
              <input
                id="trip-date"
                type="date"
                min={startDate}
                max={dateLimit}
                value={tripDate}
                onChange={(event) => setTripDate(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="trip-time">Eindtijd</label>
              <input
                id="trip-time"
                type="time"
                step="60"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                required={!editingTrip || editingTrip.endedAt !== null}
              />

              {editingTrip?.endedAt === null && (
                <p className={styles.detail}>
                  Het uur van deze oudere rit is onbekend. Je mag dit leeg
                  laten.
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="trip-start">Beginstand van de rit</label>
              <input
                id="trip-start"
                type="number"
                min={startOdometer}
                max="2147483647"
                step="1"
                inputMode="numeric"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="trip-end">Eindstand van de rit</label>
              <input
                id="trip-end"
                type="number"
                min={startNumber !== null ? startNumber + 1 : startOdometer + 1}
                max="2147483647"
                step="1"
                inputMode="numeric"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </div>

            {incomingGap > 0 && (
              <div className={styles.gapPreview} role="status">
                <h3>
                  Er ontbreekt {numbers.format(incomingGap)} km vóór deze rit
                </h3>
                <p>
                  Tussen {numbers.format(latestOdometer)}
                  {" en "}
                  {numbers.format(startNumber!)}
                  {" km zijn nog geen ritten "}
                  geregistreerd. Deze kilometers worden niet aan jouw rit
                  toegevoegd.
                </p>
              </div>
            )}

            <div className={styles.wideField}>
              <label htmlFor="trip-description">Opmerking · optioneel</label>
              <input
                id="trip-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
              />
            </div>

            <p className={styles.distance} aria-live="polite">
              {distance !== null && distance > 0
                ? `Deze rit: ${numbers.format(distance)} km`
                : "Vul beide kilometerstanden in."}
            </p>

            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}

            <div className={styles.formActions}>
              <ActionButton
                type="submit"
                icon="save"
                loading={saving}
                className={styles.primary}
              >
                {saving
                  ? "Opslaan…"
                  : editingTrip
                    ? "Wijzigingen opslaan"
                    : "Rit opslaan"}
              </ActionButton>

              <ActionButton
                icon="close"
                className={styles.secondary}
                onClick={closeForm}
              >
                Annuleren
              </ActionButton>
            </div>
          </fieldset>
        </form>
      )}

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {gaps.length > 0 && (
        <div className={styles.warning}>
          <h3>
            {numbers.format(missingDistance)}
            {" km niet toegewezen"}
          </h3>

          <details className={styles.gapDetails}>
            <summary>Ontbrekende trajecten bekijken</summary>
            <ul>
              {gaps.map((gap) => (
                <li key={`${gap.start}-${gap.end}`}>
                  {numbers.format(gap.start)}
                  {" → "}
                  {numbers.format(gap.end)} km
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <details className={styles.history}>
        <summary className={styles.historySummary}>
          <span className={styles.historyHeading}>
            <span>Rittengeschiedenis</span>
            <span className={styles.count}>{trips.length}</span>
          </span>

          <span className={styles.historyMeta}>
            {numbers.format(totalDistance)}
            {" km geregistreerd"}
          </span>
        </summary>

        {newestFirst.length === 0 ? (
          <p className={styles.empty}>Nog geen ritten geregistreerd.</p>
        ) : (
          <>
            <p className={styles.historyDescription}>
              Nieuwste kilometerstanden eerst.
              {settledRanges.length > 0
                ? " Voor ritten in een afgerekende periode moet een eigenaar die periode eerst opnieuw openen."
                : ""}
            </p>

            <ul className={styles.list}>
              {visibleTrips.map((trip) => {
                const locked = isLocked(trip);

                return (
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

                      {locked && (
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

                      {canEdit(trip) && !locked && (
                        <ActionGroup>
                          <ActionButton
                            icon="edit"
                            iconOnly
                            label={`Rit van ${trip.driverName} bewerken`}
                            className={styles.secondary}
                            disabled={busy || interactionOpen}
                            onClick={() => openEditForm(trip)}
                          />

                          <ActionButton
                            icon="trash"
                            iconOnly
                            danger
                            label={`Rit van ${trip.driverName} verwijderen`}
                            className={styles.secondary}
                            disabled={busy || interactionOpen}
                            onClick={() => openDeleteForm(trip)}
                          />
                        </ActionGroup>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {pageCount > 1 && (
              <nav className={styles.pagination} aria-label="Ritten pagineren">
                <span aria-live="polite">
                  {firstIndex + 1}–
                  {Math.min(firstIndex + PAGE_SIZE, newestFirst.length)}
                  {" van "}
                  {newestFirst.length}
                </span>

                <div className={styles.pageActions}>
                  <ActionButton
                    icon="arrow-left"
                    className={styles.secondary}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Vorige
                  </ActionButton>

                  <span>
                    {currentPage + 1} / {pageCount}
                  </span>

                  <ActionButton
                    icon="arrow-right"
                    className={styles.secondary}
                    disabled={currentPage === pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
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
