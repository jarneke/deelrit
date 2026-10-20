"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createCarRefuel, updateCarRefuel } from "@/actions/car-refuels";
import { deleteCarRefuel } from "@/actions/delete-car-refuel";
import ActionButton, { ActionGroup } from "./action-button";
import styles from "./car-trips.module.css";

type Payer = {
  userId: string;
  name: string;
};

type Refuel = {
  id: string;
  paidBy: string;
  payerName: string;
  createdBy: string;
  version: string;
  tankDate: string;
  odometer: number;
  amountCents: number;
  settledAt: string | null;
};

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  startOdometer: number;
  startDate: string;
  today: string;
  payers: Payer[];
  refuels: Refuel[];
};

const PAGE_SIZE = 5;
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

function currentDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Brussels",
  }).format(new Date());
}

function amountInput(cents: number) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

export default function CarRefuels({
  organizationId,
  currentUserId,
  isOwner,
  startOdometer,
  startDate,
  today,
  payers,
  refuels,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const deleteRef = useRef<HTMLDivElement>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingRefuel, setEditingRefuel] = useState<Refuel | null>(null);
  const [deletingRefuel, setDeletingRefuel] = useState<Refuel | null>(null);
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [tankDate, setTankDate] = useState(today);
  const [dateLimit, setDateLimit] = useState(today);
  const [odometer, setOdometer] = useState("");
  const [amount, setAmount] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const busy = saving || refreshing;
  const interactionOpen = showForm || deletingRefuel !== null;

  useEffect(() => {
    const target = showForm
      ? formRef.current
      : deletingRefuel
        ? deleteRef.current
        : null;

    target?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [showForm, deletingRefuel]);

  const chronological = [...refuels].sort((a, b) => a.odometer - b.odometer);
  const orderedRefuels = [...chronological].reverse();
  const latestRefuel = orderedRefuels[0];
  const referenceRefuel = editingRefuel ?? latestRefuel;

  const editingIndex = editingRefuel
    ? chronological.findIndex((refuel) => refuel.id === editingRefuel.id)
    : -1;

  const nextRefuel =
    editingIndex >= 0 ? chronological[editingIndex + 1] : undefined;

  const boundaryLocked = Boolean(editingRefuel && nextRefuel?.settledAt);

  const deletionLockedIds = new Set(
    chronological
      .filter((_, index) => Boolean(chronological[index + 1]?.settledAt))
      .map((refuel) => refuel.id),
  );

  const formerPayer =
    editingRefuel &&
    !payers.some((payer) => payer.userId === editingRefuel.paidBy)
      ? editingRefuel
      : null;

  const pageCount = Math.max(1, Math.ceil(orderedRefuels.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const firstIndex = currentPage * PAGE_SIZE;
  const visibleRefuels = orderedRefuels.slice(
    firstIndex,
    firstIndex + PAGE_SIZE,
  );

  function canManage(refuel: Refuel) {
    return (
      isOwner ||
      refuel.createdBy === currentUserId ||
      refuel.paidBy === currentUserId
    );
  }

  function refreshPage() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function openCreateForm() {
    if (busy || interactionOpen) return;

    const date = currentDate();

    setEditingRefuel(null);
    setPaidBy(currentUserId);
    setTankDate(date);
    setDateLimit(date);
    setOdometer("");
    setAmount("");
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditForm(refuel: Refuel) {
    if (busy || interactionOpen || !canManage(refuel) || refuel.settledAt) {
      return;
    }

    setEditingRefuel(refuel);
    setPaidBy(refuel.paidBy);
    setTankDate(refuel.tankDate);
    setDateLimit(currentDate());
    setOdometer(String(refuel.odometer));
    setAmount(amountInput(refuel.amountCents));
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openDeleteForm(refuel: Refuel) {
    if (
      busy ||
      interactionOpen ||
      !canManage(refuel) ||
      refuel.settledAt ||
      deletionLockedIds.has(refuel.id)
    ) {
      return;
    }

    setError("");
    setNotice("");
    setDeletingRefuel(refuel);
  }

  function closeForm() {
    if (busy) return;
    setShowForm(false);
    setEditingRefuel(null);
    setError("");
  }

  function closeDeleteForm() {
    if (busy) return;
    setDeletingRefuel(null);
    setError("");
  }

  async function removeRefuel() {
    if (busy || !deletingRefuel) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const result = await deleteCarRefuel({
        organizationId,
        refuelId: deletingRefuel.id,
        expectedVersion: deletingRefuel.version,
      });

      if (!result.success) {
        setError(result.error);

        if (result.refreshRequired) {
          setDeletingRefuel(null);
          refreshPage();
        }

        return;
      }

      setDeletingRefuel(null);
      setNotice(
        "Tankbeurt verwijderd. De ritten blijven behouden en de afrekening is opnieuw berekend.",
      );
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

    if (!odometer.trim() || !amount.trim()) {
      setError("Vul de kilometerstand en het bedrag in.");
      return;
    }

    setSaving(true);

    try {
      const input = {
        organizationId,
        paidBy,
        tankDate,
        odometer: Number(odometer),
        amount,
      };

      const result = editingRefuel
        ? await updateCarRefuel({
            ...input,
            refuelId: editingRefuel.id,
            expectedVersion: editingRefuel.version,
          })
        : await createCarRefuel(input);

      if (!result.success) {
        setError(result.error);
        if (result.refreshRequired) refreshPage();
        return;
      }

      if (!editingRefuel) setPage(0);

      setNotice(
        editingRefuel ? "Tankbeurt bijgewerkt." : "Tankbeurt opgeslagen.",
      );
      setShowForm(false);
      setEditingRefuel(null);
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
          <h2>Tankbeurten</h2>
          <p className={styles.subtitle}>
            Registreer hier alleen tankbeurten waarbij de tank volledig gevuld
            is.
          </p>
        </div>

        {!interactionOpen && (
          <ActionButton
            icon="plus"
            onClick={openCreateForm}
            className={styles.primary}
            disabled={busy}
          >
            Volle tankbeurt toevoegen
          </ActionButton>
        )}
      </div>

      {deletingRefuel && (
        <div
          ref={deleteRef}
          className={styles.warning}
          role="region"
          aria-label="Tankbeurt verwijderen"
        >
          <h3>Deze tankbeurt verwijderen?</h3>

          <p className={styles.detail}>
            {formatDate(deletingRefuel.tankDate)}
            {" · "}
            {numbers.format(deletingRefuel.odometer)} km
            {" · "}
            {euros.format(deletingRefuel.amountCents / 100)}
            {" · Betaald door "}
            {deletingRefuel.payerName}
          </p>

          <p className={styles.detail}>
            De ritten blijven behouden. De afrekening wordt opnieuw berekend met
            de overblijvende tankbeurten. Zonder volgende tankbeurt blijft deze
            afstand open tot er opnieuw een volle tank geregistreerd is.
          </p>

          <div className={styles.formActions}>
            <ActionButton
              icon="trash"
              danger
              loading={saving}
              disabled={busy}
              className={styles.secondary}
              onClick={removeRefuel}
            >
              {saving ? "Verwijderen…" : "Tankbeurt verwijderen"}
            </ActionButton>

            <ActionButton
              icon="close"
              className={styles.secondary}
              disabled={busy}
              onClick={closeDeleteForm}
            >
              Annuleren
            </ActionButton>
          </div>
        </div>
      )}

      {showForm && (
        <form
          ref={formRef}
          onSubmit={submit}
          className={styles.form}
          aria-label={
            editingRefuel ? "Tankbeurt bewerken" : "Tankbeurt toevoegen"
          }
        >
          <fieldset disabled={busy} className={styles.fields}>
            <div className={styles.previousTrip}>
              <p className={styles.contextLabel}>
                {editingRefuel
                  ? "Tankbeurt bewerken"
                  : latestRefuel
                    ? "Laatste volle tank"
                    : "Startpunt"}
              </p>

              <p className={styles.contextName}>
                {formatDate(referenceRefuel?.tankDate ?? startDate)}
              </p>

              <p className={styles.contextDistance}>
                {numbers.format(referenceRefuel?.odometer ?? startOdometer)} km
              </p>

              {referenceRefuel && (
                <p className={styles.detail}>
                  {euros.format(referenceRefuel.amountCents / 100)}
                  {" · Betaald door "}
                  {referenceRefuel.payerName}
                </p>
              )}
            </div>

            {boundaryLocked && nextRefuel && (
              <div className={styles.gapPreview}>
                <h3>Datum en kilometerstand liggen vast</h3>
                <p>
                  Ze vormen de startgrens van de afgerekende tankperiode die
                  eindigt op {formatDate(nextRefuel.tankDate)}. Een eigenaar
                  moet die periode eerst opnieuw openen om deze twee velden te
                  wijzigen. Bedrag en betaler kun je wel aanpassen.
                </p>
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="refuel-date">Tankdatum</label>
              <input
                id="refuel-date"
                type="date"
                min={startDate}
                max={dateLimit}
                value={tankDate}
                disabled={boundaryLocked}
                onChange={(event) => setTankDate(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="refuel-odometer">
                Kilometerstand bij het tanken
              </label>
              <input
                id="refuel-odometer"
                type="number"
                min={startOdometer + 1}
                max="2147483647"
                step="1"
                inputMode="numeric"
                value={odometer}
                disabled={boundaryLocked}
                onChange={(event) => setOdometer(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="refuel-amount">Totaal betaald bedrag (€)</label>
              <input
                id="refuel-amount"
                type="text"
                inputMode="decimal"
                placeholder="72,80"
                maxLength={11}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-describedby="refuel-amount-help"
                required
              />
              <p id="refuel-amount-help" className={styles.detail}>
                Het volledige bedrag van deze tankbeurt.
              </p>
            </div>

            <div className={styles.field}>
              <label htmlFor="refuel-payer">Wie heeft betaald?</label>
              <select
                id="refuel-payer"
                value={paidBy}
                onChange={(event) => setPaidBy(event.target.value)}
                required
              >
                {formerPayer && (
                  <option value={formerPayer.paidBy}>
                    {formerPayer.payerName}
                    {" · geen groepslid meer"}
                  </option>
                )}

                {payers.map((payer) => (
                  <option key={payer.userId} value={payer.userId}>
                    {payer.name}
                    {payer.userId === currentUserId ? " · jij" : ""}
                  </option>
                ))}
              </select>
            </div>

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
                  : editingRefuel
                    ? "Wijzigingen opslaan"
                    : "Volle tankbeurt opslaan"}
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

      {error && !showForm && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      <details className={styles.history}>
        <summary className={styles.historySummary}>
          <span className={styles.historyHeading}>
            <span>Tankgeschiedenis</span>
            <span className={styles.count}>{refuels.length}</span>
          </span>

          <span className={styles.historyMeta}>Volle tankbeurten</span>
        </summary>

        {orderedRefuels.length === 0 ? (
          <p className={styles.empty}>Nog geen tankbeurten geregistreerd.</p>
        ) : (
          <>
            <p className={styles.historyDescription}>
              Nieuwste kilometerstanden eerst. Afgerekende periodes moet een
              eigenaar eerst opnieuw openen om bijbehorende tankbeurten te
              wijzigen of te verwijderen.
            </p>

            <ul className={styles.list}>
              {visibleRefuels.map((refuel) => {
                const deletionLocked = deletionLockedIds.has(refuel.id);

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
                        <span className={styles.settledBadge}>Afgerekend</span>
                      )}

                      {!refuel.settledAt &&
                        deletionLocked &&
                        canManage(refuel) && (
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

                      {canManage(refuel) && !refuel.settledAt && (
                        <ActionGroup>
                          <ActionButton
                            icon="edit"
                            iconOnly
                            label={`Tankbeurt van ${formatDate(refuel.tankDate)} bewerken`}
                            className={styles.secondary}
                            disabled={busy || interactionOpen}
                            onClick={() => openEditForm(refuel)}
                          />

                          <ActionButton
                            icon="trash"
                            iconOnly
                            danger
                            label={
                              deletionLocked
                                ? "Verwijderen geblokkeerd: de volgende periode is afgerekend"
                                : `Tankbeurt van ${formatDate(refuel.tankDate)} verwijderen`
                            }
                            className={styles.secondary}
                            disabled={busy || interactionOpen || deletionLocked}
                            onClick={() => openDeleteForm(refuel)}
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
                  {Math.min(firstIndex + PAGE_SIZE, orderedRefuels.length)}
                  {" van "}
                  {orderedRefuels.length}
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
