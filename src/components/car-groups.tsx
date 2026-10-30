"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import ActionButton from "./action-button";
import AppIcon from "./app-icon";
import CarCard, { type CarCardData } from "./car-card";
import GlassSurface from "./glass-surface";
import ResponsiveDialog from "./responsive-dialog";
import formStyles from "./car-groups.module.css";
import styles from "./car-groups-overview.module.css";

type Props = {
  cars: CarCardData[];
};

export default function CarGroups({ cars }: Props) {
  const router = useRouter();
  const id = useId();
  const formId = id + "-form";
  const dialogId = id + "-dialog";
  const operationPending = useRef(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const busy = creating || refreshing;

  function openForm() {
    if (busy || showForm) return;

    setName("");
    setLicensePlate("");
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function cancel() {
    if (busy || operationPending.current) return;

    setShowForm(false);
    setName("");
    setLicensePlate("");
    setError("");
  }

  async function createCar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || operationPending.current) return;

    setError("");
    setNotice("");

    const cleanName = name.trim();
    const cleanPlate = licensePlate.trim().toUpperCase();

    if (!cleanName || cleanName.length > 80) {
      setError("Geef je auto een naam van maximaal 80 tekens.");
      return;
    }

    if (cleanPlate.length > 20) {
      setError("Gebruik maximaal 20 tekens voor de nummerplaat.");
      return;
    }

    operationPending.current = true;
    setCreating(true);

    try {
      const result = await authClient.organization.create({
        name: cleanName,
        slug: "auto-" + crypto.randomUUID(),
        ...(cleanPlate ? { licensePlate: cleanPlate } : {}),
      });

      if (result.error || !result.data) {
        setError("De auto kon niet worden toegevoegd. Probeer opnieuw.");
        return;
      }

      setName("");
      setLicensePlate("");
      setShowForm(false);
      setNotice(cleanName + " is toegevoegd. Jij bent de eigenaar.");

      startRefresh(() => router.refresh());
    } catch {
      setError("Verbinding mislukt. Probeer opnieuw.");
    } finally {
      operationPending.current = false;
      setCreating(false);
    }
  }

  return (
    <div className={styles.content}>
      <div className={styles.toolbar}>
        <p className={styles.count}>
          {cars.length === 1 ? "1 auto" : cars.length + " auto’s"}
        </p>

        <ActionButton
          icon="plus"
          variant="primary"
          disabled={busy || showForm}
          aria-haspopup="dialog"
          aria-expanded={showForm}
          aria-controls={dialogId}
          onClick={openForm}
        >
          Auto toevoegen
        </ActionButton>
      </div>

      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      {cars.length === 0 ? (
        <GlassSurface as="section" className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <AppIcon name="car" size={30} />
          </span>

          <h2>Jullie eerste auto begint hier.</h2>

          <p>
            Voeg een auto toe om samen ritten en tankbeurten bij te houden.
            Auto’s waarvoor je een uitnodiging aanvaardt verschijnen hier ook.
          </p>
        </GlassSurface>
      ) : (
        <ul className={styles.grid}>
          {cars.map((car, index) => (
            <li key={car.id}>
              <CarCard {...car} eager={index === 0} />
            </li>
          ))}
        </ul>
      )}

      <ResponsiveDialog
        id={dialogId}
        open={showForm}
        onClose={cancel}
        title="Een auto toevoegen"
        description="Je maakt een aparte groep voor deze auto."
        busy={busy}
        size="small"
        footer={
          <>
            <ActionButton
              icon="close"
              variant="secondary"
              disabled={busy}
              onClick={cancel}
            >
              Annuleren
            </ActionButton>

            <ActionButton
              type="submit"
              form={formId}
              icon="plus"
              variant="primary"
              loading={creating}
              disabled={busy}
            >
              {creating ? "Toevoegen…" : "Auto toevoegen"}
            </ActionButton>
          </>
        }
      >
        {showForm ? (
          <form id={formId} onSubmit={createCar} aria-busy={busy}>
            <fieldset disabled={busy} className={formStyles.fields}>
              <div className={formStyles.field}>
                <label htmlFor={id + "-name"}>Autonaam</label>

                <input
                  id={id + "-name"}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Bijvoorbeeld: Onze Clio"
                  required
                  maxLength={80}
                />
              </div>

              <div className={formStyles.field}>
                <label htmlFor={id + "-plate"}>Nummerplaat · optioneel</label>

                <input
                  id={id + "-plate"}
                  value={licensePlate}
                  onChange={(event) => setLicensePlate(event.target.value)}
                  placeholder="Bijvoorbeeld: 1-ABC-123"
                  maxLength={20}
                  autoCapitalize="characters"
                />
              </div>

              <p className={styles.formHint}>
                Je kunt de autofoto daarna aanpassen via Auto bewerken.
              </p>

              {error ? (
                <p role="alert" className={formStyles.error}>
                  {error}
                </p>
              ) : null}
            </fieldset>
          </form>
        ) : null}
      </ResponsiveDialog>
    </div>
  );
}
