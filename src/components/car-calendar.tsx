"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getCarReservationWeek } from "@/actions/car-reservation-calendar";
import {
  cancelCarReservation,
  createCarReservation,
  updateCarReservation,
} from "@/actions/car-reservations";
import type {
  CarReservation,
  ReservationWeek,
} from "@/lib/car-reservation-types";
import ActionButton from "./action-button";
import styles from "./car-calendar.module.css";

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  today: string;
};

const localFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localInput(instant: string | Date): string {
  const parts = localFormatter.formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function shiftDate(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function momentLabel(instant: string): string {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(instant));
}

function dayTime(instant: string, day: string, end: boolean): string {
  const local = localInput(instant);

  if (local.slice(0, 10) < day) return "00:00";
  if (local.slice(0, 10) > day) return end ? "24:00" : "00:00";

  return local.slice(11);
}

function appearsOnDay(item: CarReservation, day: string): boolean {
  const startDay = localInput(item.startsAt).slice(0, 10);
  const endLocal = localInput(item.endsAt);
  const endDay = endLocal.slice(0, 10);

  return (
    startDay <= day &&
    (endDay > day || (endDay === day && endLocal.slice(11) !== "00:00"))
  );
}

// Zoek het bijbehorende tijdstip in Europe/Brussels.
// Geen afhankelijkheid van de tijdzone van het toestel.
// Niet-bestaande of dubbelzinnige uren bij de klokwissel worden geweigerd.
function belgianInstant(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Vul een geldige datum en tijd in.");
  }

  const wallTime = new Date(`${value}:00.000Z`);

  if (
    !Number.isFinite(wallTime.getTime()) ||
    wallTime.toISOString().slice(0, 16) !== value
  ) {
    throw new Error("Vul een geldige datum en tijd in.");
  }

  const matches: Date[] = [];

  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(wallTime.getTime() - offset * 60000);

    if (localInput(candidate) === value) {
      matches.push(candidate);
    }
  }

  if (matches.length === 0) {
    throw new Error(
      "Dit uur bestaat niet door de overgang naar zomertijd. Kies een ander uur.",
    );
  }

  if (matches.length > 1) {
    throw new Error(
      "Dit uur komt tweemaal voor door de overgang naar wintertijd. Kies een uur buiten die klokwissel.",
    );
  }

  return matches[0];
}

export default function CarCalendar({
  organizationId,
  currentUserId,
  isOwner,
  today,
}: Props) {
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(() => mondayOf(today));
  const [data, setData] = useState<ReservationWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [modal, setModal] = useState<{
    reservation: CarReservation | null;
    date: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      try {
        const result = await getCarReservationWeek(organizationId, week);

        if (cancelled) return;

        if (!result.success) {
          setError(result.error);
          return;
        }

        setData(result.data);
        setError("");
      } catch {
        if (!cancelled) {
          setError("De agenda kon niet worden geladen. Probeer opnieuw.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, week, retry]);

  function reload() {
    setLoading(true);
    setError("");
    setRetry((value) => value + 1);
  }

  function changeWeek(next: string) {
    if (next === week) return;
    setLoading(true);
    setError("");
    setWeek(next);
  }

  const days = Array.from({ length: 7 }, (_, index) => shiftDate(week, index));

  return (
    <section className={styles.panel} aria-label="Autoagenda">
      <div className={styles.toolbar}>
        <div>
          <h2>Agenda</h2>
          <p className={styles.subtitle}>Plan wanneer je de auto nodig hebt.</p>
        </div>

        <ActionButton
          icon="plus"
          className={styles.primary}
          onClick={() => {
            setNotice("");
            setModal({ reservation: null, date: today });
          }}
        >
          Reserveren
        </ActionButton>
      </div>

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      <details
        className={styles.calendarFold}
        open={open}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;

          if (nextOpen !== open) {
            setLoading(true);
            setError("");
            setOpen(nextOpen);
          }
        }}
      >
        <summary className={styles.calendarSummary}>
          <span>Weekagenda</span>
          <span className={styles.summaryDate}>
            {dateLabel(week)} – {dateLabel(shiftDate(week, 6))}
          </span>
        </summary>

        {open && (
          <>
            <nav className={styles.navigation} aria-label="Kalenderweek">
              <div className={styles.weekControls}>
                <ActionButton
                  icon="arrow-left"
                  iconOnly
                  label="Vorige week"
                  className={styles.secondary}
                  disabled={week <= "1900-01-08"}
                  onClick={() => changeWeek(shiftDate(week, -7))}
                />

                <span className={styles.weekLabel}>
                  {dateLabel(week)} – {dateLabel(shiftDate(week, 6))}
                  {" · "}
                  {week.slice(0, 4)}
                </span>

                <ActionButton
                  icon="arrow-right"
                  iconOnly
                  label="Volgende week"
                  className={styles.secondary}
                  disabled={week >= "9998-12-21"}
                  onClick={() => changeWeek(shiftDate(week, 7))}
                />
              </div>

              <button
                type="button"
                className={styles.todayButton}
                onClick={() => changeWeek(mondayOf(today))}
              >
                Deze week
              </button>
            </nav>

            {loading ? (
              <p role="status" className={styles.message}>
                De reserveringen voor deze week laden…
              </p>
            ) : error ? (
              <div className={styles.message}>
                <p role="alert" className={styles.error}>
                  {error}
                </p>
                <ActionButton
                  icon="undo"
                  className={styles.secondary}
                  onClick={reload}
                >
                  Opnieuw proberen
                </ActionButton>
              </div>
            ) : (
              <div className={styles.week}>
                {days.map((day) => {
                  const items =
                    data?.items.filter((item) => appearsOnDay(item, day)) ?? [];

                  return (
                    <section
                      key={day}
                      className={`${styles.day} ${day === today ? styles.currentDay : ""}`}
                      aria-label={day}
                    >
                      <h3 className={styles.dayHeading}>
                        <span>
                          {new Intl.DateTimeFormat("nl-BE", {
                            weekday: "short",
                            timeZone: "UTC",
                          }).format(new Date(`${day}T12:00:00.000Z`))}
                        </span>
                        <span>{dateLabel(day)}</span>
                      </h3>

                      <div className={styles.bookings}>
                        {items.length === 0 ? (
                          <p className={styles.empty}>Geen reserveringen</p>
                        ) : (
                          items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`${styles.booking} ${
                                item.reservedBy === currentUserId
                                  ? styles.ownBooking
                                  : ""
                              }`}
                              onClick={() => {
                                setNotice("");
                                setModal({ reservation: item, date: day });
                              }}
                            >
                              <strong>{item.reservedByName}</strong>
                              <span>
                                {dayTime(item.startsAt, day, false)}
                                {" – "}
                                {dayTime(item.endsAt, day, true)}
                              </span>
                              {item.description && (
                                <span className={styles.preview}>
                                  {item.description}
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </details>

      {modal && (
        <ReservationModal
          organizationId={organizationId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          reservation={modal.reservation}
          date={modal.date}
          onClose={() => setModal(null)}
          onRefresh={reload}
          onSaved={(message, date) => {
            setModal(null);
            setNotice(message);
            setOpen(true);
            const targetWeek = mondayOf(date);

            if (targetWeek !== week) {
              changeWeek(targetWeek);
            } else {
              reload();
            }
          }}
        />
      )}
    </section>
  );
}

function ReservationModal({
  organizationId,
  currentUserId,
  isOwner,
  reservation,
  date,
  onClose,
  onRefresh,
  onSaved,
}: {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  reservation: CarReservation | null;
  date: string;
  onClose: () => void;
  onRefresh: () => void;
  onSaved: (message: string, date: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const startId = useId();
  const endId = useId();
  const descriptionId = useId();

  const [start, setStart] = useState(
    reservation ? localInput(reservation.startsAt) : `${date}T09:00`,
  );
  const [end, setEnd] = useState(
    reservation ? localInput(reservation.endsAt) : `${date}T10:00`,
  );
  const [description, setDescription] = useState(
    reservation?.description ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const canManage =
    !reservation || isOwner || reservation.reservedBy === currentUserId;

  const canEdit =
    canManage &&
    (!reservation || new Date(reservation.startsAt).getTime() > now);

  const canCancel =
    canManage &&
    reservation !== null &&
    new Date(reservation.endsAt).getTime() > now;

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();

    return () => {
      element?.close();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canEdit) return;

    setError("");

    let startsAt: Date;
    let endsAt: Date;

    try {
      startsAt = belgianInstant(start);
      endsAt = belgianInstant(end);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Controleer de tijdstippen.",
      );
      return;
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      setError("De eindtijd moet na de begintijd liggen.");
      return;
    }

    setBusy(true);

    try {
      const input = {
        organizationId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        description,
      };

      const result = reservation
        ? await updateCarReservation({
            ...input,
            reservationId: reservation.id,
            expectedVersion: reservation.version,
          })
        : await createCarReservation(input);

      if (!result.success) {
        setError(result.error);
        if (result.refreshRequired) onRefresh();
        return;
      }

      onSaved(
        reservation ? "Reservering bijgewerkt." : "De auto is gereserveerd.",
        start.slice(0, 10),
      );
    } catch {
      setError("Opslaan is niet gelukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!reservation || busy || !canCancel) return;

    setBusy(true);
    setError("");

    try {
      const result = await cancelCarReservation({
        organizationId,
        reservationId: reservation.id,
        expectedVersion: reservation.version,
      });

      if (!result.success) {
        setError(result.error);
        if (result.refreshRequired) onRefresh();
        return;
      }

      onSaved(
        "Reservering geannuleerd.",
        localInput(reservation.startsAt).slice(0, 10),
      );
    } catch {
      setError("Annuleren is niet gelukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.toolbar}>
        <h2 id={titleId}>{reservation ? "Reservering" : "Auto reserveren"}</h2>

        <ActionButton
          icon="close"
          iconOnly
          label="Sluiten"
          className={styles.secondary}
          disabled={busy}
          onClick={onClose}
        />
      </div>

      <p className={styles.subtitle}>
        {reservation
          ? `Gereserveerd door ${reservation.reservedByName}.`
          : "Je reserveert de auto voor jezelf."}{" "}
        Alle tijden zijn Belgische tijd.
      </p>

      {canEdit ? (
        <form onSubmit={submit} className={styles.form}>
          <fieldset className={styles.fields} disabled={busy}>
            <div className={styles.field}>
              <label htmlFor={startId}>Van</label>
              <input
                id={startId}
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor={endId}>Tot</label>
              <input
                id={endId}
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor={descriptionId}>Opmerking · optioneel</label>
              <textarea
                id={descriptionId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>

            <ActionButton
              type="submit"
              icon="save"
              loading={busy}
              className={styles.primary}
            >
              {reservation ? "Wijzigingen opslaan" : "Reserveren"}
            </ActionButton>
          </fieldset>
        </form>
      ) : reservation ? (
        <div className={styles.details}>
          <p>
            <strong>Van:</strong> {momentLabel(reservation.startsAt)}
          </p>
          <p>
            <strong>Tot:</strong> {momentLabel(reservation.endsAt)}
          </p>
          {reservation.description && <p>{reservation.description}</p>}
        </div>
      ) : null}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {canCancel && (
        <div className={styles.cancelArea}>
          {confirmCancel ? (
            <>
              <p>Wil je deze reservering annuleren?</p>
              <div className={styles.weekControls}>
                <ActionButton
                  icon="trash"
                  danger
                  loading={busy}
                  className={styles.secondary}
                  onClick={cancel}
                >
                  Ja, annuleren
                </ActionButton>
                <button
                  type="button"
                  className={styles.todayButton}
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                >
                  Behouden
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={styles.cancelButton}
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              Reservering annuleren
            </button>
          )}
        </div>
      )}
    </dialog>
  );
}
