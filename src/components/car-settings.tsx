"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { updateCarSettings } from "@/actions/car-settings";
import { carPhotoPreview, prepareCarPhoto } from "@/lib/car-photo-client";
import ActionButton from "./action-button";
import { CarPhoto } from "./car-hero";
import ResponsiveDialog from "./responsive-dialog";
import formStyles from "./car-groups.module.css";
import styles from "./car-settings.module.css";

type BusyState = "photo" | "save" | null;
type PhotoMode = "keep" | "replace" | "remove";

type Props = {
  organizationId: string;
  name: string;
  licensePlate: string | null;
  photoUrl: string | null;
  photoSource: string;
};

export default function CarSettings({
  organizationId,
  name,
  licensePlate,
  photoUrl,
  photoSource,
}: Props) {
  const router = useRouter();
  const dialogId = useId();
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [busyState, setBusyState] = useState<BusyState>(null);
  const [notice, setNotice] = useState("");

  const busy = busyState !== null;

  function close() {
    if (!busy) setOpen(false);
  }

  return (
    <div className={styles.settings}>
      <ActionButton
        icon="edit"
        iconOnly
        label="Auto bewerken"
        variant="glass"
        style={{ padding: 0, borderRadius: "50%" }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => {
          setNotice("");
          setOpen(true);
        }}
      />

      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}

      <ResponsiveDialog
        id={dialogId}
        open={open}
        onClose={close}
        title="Auto bewerken"
        description="Pas de foto, naam of nummerplaat van je auto aan."
        size="medium"
        busy={busy}
        footer={
          <>
            <ActionButton
              icon="close"
              variant="secondary"
              disabled={busy}
              onClick={close}
            >
              Annuleren
            </ActionButton>

            <ActionButton
              icon="save"
              type="submit"
              form={formId}
              variant="primary"
              loading={busy}
            >
              {busyState === "photo"
                ? "Foto verwerken…"
                : busyState === "save"
                  ? "Opslaan…"
                  : "Opslaan"}
            </ActionButton>
          </>
        }
      >
        {open ? (
          <SettingsForm
            formId={formId}
            organizationId={organizationId}
            name={name}
            licensePlate={licensePlate}
            photoUrl={photoUrl}
            photoSource={photoSource}
            busy={busy}
            onBusyChange={setBusyState}
            onSaved={(warning) => {
              setOpen(false);
              setNotice(
                warning
                  ? "De autogegevens zijn opgeslagen. " + warning
                  : "De autogegevens zijn opgeslagen.",
              );
              router.refresh();
            }}
          />
        ) : null}
      </ResponsiveDialog>
    </div>
  );
}

function SettingsForm({
  formId,
  organizationId,
  name,
  licensePlate,
  photoUrl,
  photoSource,
  busy,
  onBusyChange,
  onSaved,
}: Props & {
  formId: string;
  busy: boolean;
  onBusyChange: (state: BusyState) => void;
  onSaved: (warning?: string) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const operationPending = useRef(false);

  const [carName, setCarName] = useState(name);
  const [plate, setPlate] = useState(licensePlate ?? "");
  const [photoMode, setPhotoMode] = useState<PhotoMode>("keep");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file || busy || operationPending.current) return;

    operationPending.current = true;
    setError("");
    onBusyChange("photo");

    try {
      const prepared = await prepareCarPhoto(file);
      const source = await carPhotoPreview(prepared);

      setPhotoFile(prepared);
      setPreview(source);
      setPhotoMode("replace");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "De foto kon niet worden verwerkt.",
      );
    } finally {
      operationPending.current = false;
      onBusyChange(null);
    }
  }

  function useDefaultPhoto() {
    if (busy || operationPending.current) return;

    setPhotoMode("remove");
    setPhotoFile(null);
    setPreview(null);
    setError("");
  }

  function undoPhotoChange() {
    if (busy || operationPending.current) return;

    setPhotoMode("keep");
    setPhotoFile(null);
    setPreview(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || operationPending.current) return;

    setError("");

    if (!carName.trim()) {
      setError("Geef je auto een naam.");
      return;
    }

    if (photoMode === "replace" && !photoFile) {
      setError("Kies eerst een autofoto.");
      return;
    }

    const photoData = new FormData();
    photoData.set("mode", photoMode);
    photoData.set("expectedPhoto", photoUrl ?? "");

    if (photoMode === "replace" && photoFile) {
      photoData.set("file", photoFile);
    }

    operationPending.current = true;
    onBusyChange("save");

    try {
      const result = await updateCarSettings(
        organizationId,
        carName,
        plate,
        photoData,
      );

      if (!result.success) {
        setError(result.error);
        return;
      }

      onSaved(result.warning);
    } catch {
      setError("Verbinding mislukt. Probeer opnieuw.");
    } finally {
      operationPending.current = false;
      onBusyChange(null);
    }
  }

  return (
    <form id={formId} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className={formStyles.fields}>
        <div className={styles.photoField}>
          <h3>Autofoto</h3>

          <div className={styles.photoPreview}>
            {photoMode === "remove" ? (
              <div className={styles.defaultPreview}>
                <span>Standaardfoto</span>
                <p>Na opslaan wordt de standaardfoto getoond.</p>
              </div>
            ) : (
              <CarPhoto
                src={preview ?? photoSource}
                alt="Voorbeeld van de autofoto"
                eager
              />
            )}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => void selectPhoto(event)}
          />

          <div className={styles.photoActions}>
            <ActionButton
              icon="plus"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
            >
              Foto kiezen
            </ActionButton>

            <ActionButton
              icon="undo"
              variant="ghost"
              disabled={
                photoMode === "remove" || (!photoUrl && photoMode !== "replace")
              }
              onClick={useDefaultPhoto}
            >
              Standaardfoto gebruiken
            </ActionButton>
          </div>

          {photoMode !== "keep" ? (
            <ActionButton icon="undo" variant="ghost" onClick={undoPhotoChange}>
              Fotowijziging ongedaan maken
            </ActionButton>
          ) : null}

          <p className={styles.photoHint}>
            JPEG, PNG of WebP, maximaal 20 MB. De foto wordt automatisch
            verkleind en wijzigt pas wanneer je opslaat.
          </p>
        </div>

        <div className={formStyles.field}>
          <label htmlFor={id + "-name"}>Autonaam</label>

          <input
            id={id + "-name"}
            value={carName}
            onChange={(event) => setCarName(event.target.value)}
            required
            maxLength={80}
          />
        </div>

        <div className={formStyles.field}>
          <label htmlFor={id + "-plate"}>Nummerplaat · optioneel</label>

          <input
            id={id + "-plate"}
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            maxLength={20}
            autoCapitalize="characters"
          />
        </div>

        {error ? (
          <p role="alert" className={formStyles.error}>
            {error}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
