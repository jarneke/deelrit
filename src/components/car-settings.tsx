"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateCarSettings } from "@/actions/car-settings";
import formStyles from "./car-groups.module.css";
import styles from "./car-settings.module.css";

type Props = {
  organizationId: string;
  name: string;
  licensePlate: string | null;
};

export default function CarSettings({
  organizationId,
  name,
  licensePlate,
}: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function close() {
    if (busy) return;
    dialog.current?.close();
  }

  return (
    <div className={styles.settings}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        onClick={() => {
          setNotice("");
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        Auto bewerken
      </button>

      <span role="status" className={styles.srOnly}>
        {notice}
      </span>

      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => setOpen(false)}
      >
        <div className={styles.header}>
          <h2 id={titleId}>Auto bewerken</h2>

          <button
            type="button"
            className={styles.close}
            aria-label="Sluiten"
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </div>

        <p id={descriptionId} className={styles.description}>
          Pas de naam of nummerplaat van je auto aan.
        </p>

        {open && (
          <SettingsForm
            organizationId={organizationId}
            name={name}
            licensePlate={licensePlate}
            busy={busy}
            onBusyChange={setBusy}
            onCancel={close}
            onSaved={() => {
              dialog.current?.close();
              setNotice("De autogegevens zijn opgeslagen.");
              router.refresh();
            }}
          />
        )}
      </dialog>
    </div>
  );
}

function SettingsForm({
  organizationId,
  name,
  licensePlate,
  busy,
  onBusyChange,
  onSaved,
  onCancel,
}: Props & {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const plateId = useId();
  const [carName, setCarName] = useState(name);
  const [plate, setPlate] = useState(licensePlate ?? "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");

    if (!carName.trim()) {
      setError("Geef je auto een naam.");
      return;
    }

    onBusyChange(true);

    try {
      const result = await updateCarSettings(organizationId, carName, plate);

      if (!result.success) {
        setError(result.error);
        return;
      }

      onSaved();
    } catch {
      setError("Verbinding mislukt. Probeer opnieuw.");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className={formStyles.fields}>
        <div className={formStyles.field}>
          <label htmlFor={nameId}>Autonaam</label>
          <input
            id={nameId}
            value={carName}
            onChange={(event) => setCarName(event.target.value)}
            required
            maxLength={80}
          />
        </div>

        <div className={formStyles.field}>
          <label htmlFor={plateId}>Nummerplaat · optioneel</label>
          <input
            id={plateId}
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            maxLength={20}
            autoCapitalize="characters"
          />
        </div>

        {error && (
          <p role="alert" className={formStyles.error}>
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            className={formStyles.secondary}
          >
            Annuleren
          </button>

          <button type="submit" className={formStyles.primary}>
            {busy ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
