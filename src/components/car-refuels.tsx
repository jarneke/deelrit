"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCarRefuel, updateCarRefuel } from "@/actions/car-refuels";
import { deleteCarRefuel } from "@/actions/delete-car-refuel";
import type { RefuelHistoryItem } from "@/lib/car-history-types";
import ActionButton from "./action-button";
import CarRefuelHistory from "./car-refuel-history";
import ResponsiveDialog from "./responsive-dialog";
import styles from "./car-trips.module.css";
import entryStyles from "./car-entry-form.module.css";

type Payer = {
  userId: string;
  name: string;
};

type LatestRefuel = Omit<RefuelHistoryItem, "boundaryLocked" | "nextRefuel">;

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  startOdometer: number;
  startDate: string;
  today: string;
  payers: Payer[];
  latestRefuel: LatestRefuel | null;
  refuelCount: number;
  historyRevision: string;
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
  latestRefuel,
  refuelCount,
  historyRevision,
}: Props) {
  const router = useRouter();
  const id = useId();
  const formId = `${id}-form`;
  const dialogId = `${id}-dialog`;

  const [showForm, setShowForm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [editingRefuel, setEditingRefuel] = useState<RefuelHistoryItem | null>(
    null,
  );

  const [deletingRefuel, setDeletingRefuel] =
    useState<RefuelHistoryItem | null>(null);

  const [paidBy, setPaidBy] = useState(currentUserId);
  const [tankDate, setTankDate] = useState(today);
  const [dateLimit, setDateLimit] = useState(today);
  const [odometer, setOdometer] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const busy = saving || refreshing;
  const interactionOpen = showForm || deletingRefuel !== null;

  const referenceRefuel = editingRefuel ?? latestRefuel;
  const nextRefuel = editingRefuel?.nextRefuel;
  const boundaryLocked = editingRefuel?.boundaryLocked ?? false;

  const formerPayer =
    editingRefuel &&
    !payers.some((payer) => payer.userId === editingRefuel.paidBy)
      ? editingRefuel
      : null;

  function canManage(refuel: RefuelHistoryItem) {
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

  function openEditForm(refuel: RefuelHistoryItem) {
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

  function openDeleteForm(refuel: RefuelHistoryItem) {
    if (
      busy ||
      interactionOpen ||
      !canManage(refuel) ||
      refuel.settledAt ||
      refuel.boundaryLocked
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

        if (result.refreshRequired) {
          refreshPage();
        }

        return;
      }

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

        <ActionButton
          icon="plus"
          variant="primary"
          onClick={openCreateForm}
          disabled={busy || interactionOpen}
          aria-haspopup="dialog"
          aria-expanded={showForm}
          aria-controls={dialogId}
        >
          Volle tankbeurt toevoegen
        </ActionButton>
      </div>

      {!interactionOpen && error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <ResponsiveDialog
        id={dialogId}
        open={showForm}
        onClose={closeForm}
        title={editingRefuel ? "Tankbeurt bewerken" : "Tankbeurt toevoegen"}
        description="Registreer een volle tank en het volledige betaalde bedrag."
        busy={busy}
        size="medium"
        footer={
          <>
            <ActionButton
              icon="close"
              variant="secondary"
              disabled={busy}
              onClick={closeForm}
            >
              Annuleren
            </ActionButton>

            <ActionButton
              type="submit"
              form={formId}
              icon="save"
              variant="primary"
              loading={saving}
              disabled={busy}
            >
              {saving
                ? "Opslaan…"
                : editingRefuel
                  ? "Wijzigingen opslaan"
                  : "Volle tankbeurt opslaan"}
            </ActionButton>
          </>
        }
      >
        {showForm ? (
          <form
            id={formId}
            onSubmit={submit}
            className={entryStyles.entryForm}
            aria-label={
              editingRefuel ? "Tankbeurt bewerken" : "Tankbeurt toevoegen"
            }
            aria-busy={busy}
          >
            <fieldset disabled={busy} className={styles.fields}>
              <div className={`${styles.previousTrip} ${entryStyles.context}`}>
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
                  {numbers.format(referenceRefuel?.odometer ?? startOdometer)}{" "}
                  km
                </p>

                {referenceRefuel ? (
                  <p className={styles.detail}>
                    {euros.format(referenceRefuel.amountCents / 100)}
                    {" · Betaald door "}
                    {referenceRefuel.payerName}
                  </p>
                ) : null}
              </div>

              {boundaryLocked && nextRefuel ? (
                <div className={styles.gapPreview}>
                  <h3>Datum en kilometerstand liggen vast</h3>

                  <p>
                    Ze vormen de startgrens van de afgerekende tankperiode die
                    eindigt op {formatDate(nextRefuel.tankDate)}. Een eigenaar
                    moet die periode eerst opnieuw openen om deze twee velden te
                    wijzigen. Bedrag en betaler kun je wel aanpassen.
                  </p>
                </div>
              ) : null}

              <div className={styles.field}>
                <label htmlFor={`${id}-date`}>Tankdatum</label>

                <input
                  id={`${id}-date`}
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
                <label htmlFor={`${id}-odometer`}>
                  Kilometerstand bij het tanken
                </label>

                <input
                  id={`${id}-odometer`}
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
                <label htmlFor={`${id}-amount`}>
                  Totaal betaald bedrag (€)
                </label>

                <input
                  id={`${id}-amount`}
                  type="text"
                  inputMode="decimal"
                  placeholder="72,80"
                  maxLength={11}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-describedby={`${id}-amount-help`}
                  required
                />

                <p id={`${id}-amount-help`} className={styles.detail}>
                  Het volledige bedrag van deze tankbeurt.
                </p>
              </div>

              <div className={styles.field}>
                <label htmlFor={`${id}-payer`}>Wie heeft betaald?</label>

                <select
                  id={`${id}-payer`}
                  value={paidBy}
                  onChange={(event) => setPaidBy(event.target.value)}
                  required
                >
                  {formerPayer ? (
                    <option value={formerPayer.paidBy}>
                      {formerPayer.payerName}
                      {" · geen groepslid meer"}
                    </option>
                  ) : null}

                  {payers.map((payer) => (
                    <option key={payer.userId} value={payer.userId}>
                      {payer.name}
                      {payer.userId === currentUserId ? " · jij" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
            </fieldset>
          </form>
        ) : null}
      </ResponsiveDialog>

      <ResponsiveDialog
        open={deletingRefuel !== null}
        onClose={closeDeleteForm}
        title="Tankbeurt verwijderen?"
        busy={busy}
        size="small"
        footer={
          <>
            <ActionButton
              icon="close"
              variant="secondary"
              disabled={busy}
              onClick={closeDeleteForm}
            >
              Annuleren
            </ActionButton>

            <ActionButton
              icon="trash"
              variant="primary"
              danger
              loading={saving}
              disabled={busy}
              onClick={() => void removeRefuel()}
            >
              {saving ? "Verwijderen…" : "Tankbeurt verwijderen"}
            </ActionButton>
          </>
        }
      >
        {deletingRefuel ? (
          <div className={entryStyles.deleteContent}>
            <div className={entryStyles.deleteSummary}>
              <p className={styles.description}>
                <strong>{formatDate(deletingRefuel.tankDate)}</strong>
                <br />
                {numbers.format(deletingRefuel.odometer)} km
                {" · "}
                {euros.format(deletingRefuel.amountCents / 100)}
                <br />
                Betaald door {deletingRefuel.payerName}
              </p>
            </div>

            <p className={entryStyles.deleteExplanation}>
              De ritten blijven behouden. De afrekening wordt opnieuw berekend
              met de overblijvende tankbeurten. Zonder volgende tankbeurt blijft
              deze afstand open tot er opnieuw een volle tank geregistreerd is.
            </p>

            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialog>

      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      <CarRefuelHistory
        key={`${organizationId}:${historyRevision}`}
        organizationId={organizationId}
        currentUserId={currentUserId}
        isOwner={isOwner}
        total={refuelCount + 1}
        open={historyOpen}
        busy={busy || interactionOpen}
        onOpenChange={setHistoryOpen}
        onEdit={openEditForm}
        onDelete={openDeleteForm}
      />
    </section>
  );
}
