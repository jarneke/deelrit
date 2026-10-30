"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { updateProfilePhoto } from "@/actions/profile-photo";
import { carPhotoPreview as profilePhotoPreview } from "@/lib/car-photo-client";
import {
  clamp,
  cropBounds,
  loadCropImage,
  exportProfileCrop,
  type CropPosition,
} from "@/lib/profile-photo-crop";
import ActionButton, { ActionGroup } from "./action-button";
import GlassSurface from "./glass-surface";
import ResponsiveDialog from "./responsive-dialog";
import styles from "./profile-photo.module.css";

type Props = {
  name: string;
  email: string;
  photoUrl: string | null;
  photoSource: string | null;
};

type CropImage = {
  source: string;
  image: HTMLImageElement;
};

type Point = {
  x: number;
  y: number;
};

function Avatar({ name, source }: { name: string; source: string | null }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  return (
    <div className={styles.avatar} aria-hidden="true">
      {source && failedSource !== source ? (
        <Image
          key={source}
          src={source}
          alt=""
          width={160}
          height={160}
          unoptimized
          onError={() => setFailedSource(source)}
        />
      ) : (
        initials
      )}
    </div>
  );
}

export default function ProfilePhoto({
  name,
  email,
  photoUrl,
  photoSource,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return (
    <>
      <GlassSurface
        as="section"
        className={styles.profile}
        aria-labelledby="profile-name"
      >
        <Avatar name={name} source={photoSource} />

        <div className={styles.identity}>
          <h2 id="profile-name">{name}</h2>
          <p>{email}</p>
        </div>

        <ActionButton
          icon="edit"
          variant="glass"
          className={styles.edit}
          onClick={() => {
            setNotice("");
            setOpen(true);
          }}
        >
          Profielfoto
        </ActionButton>
      </GlassSurface>

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {open && (
        <PhotoEditor
          name={name}
          photoUrl={photoUrl}
          photoSource={photoSource}
          onClose={() => setOpen(false)}
          onSaved={(message) => {
            setNotice(message);
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function reframe(
  image: HTMLImageElement,
  start: CropPosition,
  zoom: number,
  from: Point,
  to: Point,
  size: number,
): CropPosition {
  const old = cropBounds(image.naturalWidth, image.naturalHeight, start);

  const nextZoom = clamp(zoom, 1, 3);
  const side = Math.min(image.naturalWidth, image.naturalHeight) / nextZoom;

  const x = old.x + (from.x / size) * old.side - (to.x / size) * side;
  const y = old.y + (from.y / size) * old.side - (to.y / size) * side;

  return {
    zoom: nextZoom,
    x:
      image.naturalWidth > side
        ? clamp(x / (image.naturalWidth - side), 0, 1)
        : 0.5,
    y:
      image.naturalHeight > side
        ? clamp(y / (image.naturalHeight - side), 0, 1)
        : 0.5,
  };
}

function CropCanvas({
  crop,
  position,
  onChange,
  disabled,
}: {
  crop: CropImage;
  position: CropPosition;
  onChange: (value: CropPosition) => void;
  disabled: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef(position);
  const pointers = useRef(new Map<number, Point>());

  const gesture = useRef<{
    start: CropPosition;
    center: Point;
    distance: number;
  } | null>(null);

  const bounds = cropBounds(
    crop.image.naturalWidth,
    crop.image.naturalHeight,
    position,
  );

  const helpId = useId();

  function commit(next: CropPosition) {
    latest.current = next;
    onChange(next);
  }

  function metrics() {
    const points = Array.from(pointers.current.values());
    if (!points.length) return null;

    const first = points[0];
    const second = points[1];

    return second
      ? {
          center: {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          },
          distance: Math.max(
            1,
            Math.hypot(first.x - second.x, first.y - second.y),
          ),
        }
      : { center: first, distance: 0 };
  }

  function rebase() {
    const value = metrics();

    gesture.current = value ? { start: latest.current, ...value } : null;
  }

  function localPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function release(pointerId: number) {
    if (!pointers.current.delete(pointerId)) return;
    rebase();
  }

  useEffect(() => {
    const element = surface.current;
    if (!element) return;

    function wheel(event: WheelEvent) {
      event.preventDefault();

      if (disabled || pointers.current.size || !element) return;

      const rect = element.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);

      const zoom =
        latest.current.zoom * Math.exp(-clamp(delta, -100, 100) * 0.003);

      const next = reframe(
        crop.image,
        latest.current,
        zoom,
        point,
        point,
        rect.width,
      );

      latest.current = next;
      onChange(next);
    }

    element.addEventListener("wheel", wheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", wheel);
    };
  }, [crop.image, disabled, onChange]);

  return (
    <div className={styles.cropEditor}>
      <div
        ref={surface}
        className={styles.crop}
        role="group"
        aria-label="Foto bijsnijden"
        aria-describedby={helpId}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || pointers.current.size >= 2) {
            return;
          }

          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, localPoint(event));
          rebase();
        }}
        onPointerMove={(event) => {
          if (disabled || !pointers.current.has(event.pointerId)) {
            return;
          }

          pointers.current.set(event.pointerId, localPoint(event));

          const value = metrics();
          const start = gesture.current;

          if (!value || !start) return;

          const zoom =
            start.distance > 0 && value.distance > 0
              ? (start.start.zoom * value.distance) / start.distance
              : start.start.zoom;

          commit(
            reframe(
              crop.image,
              start.start,
              zoom,
              start.center,
              value.center,
              event.currentTarget.getBoundingClientRect().width,
            ),
          );
        }}
        onPointerUp={(event) => release(event.pointerId)}
        onPointerCancel={(event) => release(event.pointerId)}
        onLostPointerCapture={(event) => release(event.pointerId)}
        onKeyDown={(event) => {
          if (disabled) return;

          const size = event.currentTarget.getBoundingClientRect().width;
          const center = { x: size / 2, y: size / 2 };
          const step = event.shiftKey ? 30 : 10;

          let to = center;
          let zoom = latest.current.zoom;

          if (event.key === "ArrowLeft") {
            to = { ...center, x: center.x - step };
          } else if (event.key === "ArrowRight") {
            to = { ...center, x: center.x + step };
          } else if (event.key === "ArrowUp") {
            to = { ...center, y: center.y - step };
          } else if (event.key === "ArrowDown") {
            to = { ...center, y: center.y + step };
          } else if (event.key === "+" || event.key === "=") {
            zoom *= 1.1;
          } else if (event.key === "-") {
            zoom /= 1.1;
          } else if (event.key === "Home") {
            event.preventDefault();
            commit({ zoom: 1, x: 0.5, y: 0.5 });
            return;
          } else {
            return;
          }

          event.preventDefault();

          commit(reframe(crop.image, latest.current, zoom, center, to, size));
        }}
      >
        <Image
          src={crop.source}
          alt=""
          width={crop.image.naturalWidth}
          height={crop.image.naturalHeight}
          unoptimized
          draggable={false}
          className={styles.cropImage}
          style={{
            width: `${(crop.image.naturalWidth / bounds.side) * 100}%`,
            height: `${(crop.image.naturalHeight / bounds.side) * 100}%`,
            left: `${(-bounds.x / bounds.side) * 100}%`,
            top: `${(-bounds.y / bounds.side) * 100}%`,
          }}
        />

        <div className={styles.cropMask} aria-hidden="true" />

        <span className={styles.zoomBadge} aria-hidden="true">
          {Math.round(position.zoom * 100)}%
        </span>
      </div>

      <p id={helpId} className={styles.gestureHint}>
        Versleep om te verplaatsen. Knijp met twee vingers of scroll om te
        zoomen.
      </p>

      <ActionButton
        icon="undo"
        variant="ghost"
        disabled={disabled}
        onClick={() => commit({ zoom: 1, x: 0.5, y: 0.5 })}
      >
        Herstellen
      </ActionButton>

      <span className={styles.keyboardHint}>
        Toetsenbord: pijltjes om te verplaatsen, + en − om te zoomen.
      </span>
    </div>
  );
}

function PhotoEditor({
  name,
  photoUrl,
  photoSource,
  onClose,
  onSaved,
}: {
  name: string;
  photoUrl: string | null;
  photoSource: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const operation = useRef(false);

  const [mode, setMode] = useState<"keep" | "replace" | "remove">("keep");
  const [crop, setCrop] = useState<CropImage | null>(null);

  const [position, setPosition] = useState<CropPosition>({
    zoom: 1,
    x: 0.5,
    y: 0.5,
  });

  const [preparing, setPreparing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);

  const busy = preparing || pending;
  const disabled = busy || reloadRequired;

  async function beginCrop(source: string) {
    const image = await loadCropImage(source);

    setCrop({ source, image });
    setPosition({ zoom: 1, x: 0.5, y: 0.5 });
    setMode("replace");
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";

    if (!selected || operation.current || reloadRequired) return;

    operation.current = true;
    setPreparing(true);
    setError("");

    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
        throw new Error("Kies een JPEG-, PNG- of WebP-foto.");
      }

      if (!selected.size || selected.size > 20 * 1024 * 1024) {
        throw new Error("Kies een foto van maximaal 20 MB.");
      }

      await beginCrop(await profilePhotoPreview(selected));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "De foto kon niet worden verwerkt.",
      );
    } finally {
      operation.current = false;
      setPreparing(false);
    }
  }

  async function editCurrent() {
    if (!photoSource || operation.current || reloadRequired) return;

    operation.current = true;
    setPreparing(true);
    setError("");

    try {
      await beginCrop(photoSource);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "De foto kon niet worden geladen.",
      );
    } finally {
      operation.current = false;
      setPreparing(false);
    }
  }

  function reset() {
    if (operation.current) return;

    setMode("keep");
    setCrop(null);
    setPosition({ zoom: 1, x: 0.5, y: 0.5 });
    setError("");
  }

  async function save() {
    if (operation.current || mode === "keep" || reloadRequired) return;
    if (mode === "replace" && !crop) return;

    operation.current = true;
    setPreparing(true);
    setError("");

    const data = new FormData();
    data.set("mode", mode);
    data.set("expectedPhoto", photoUrl ?? "");

    try {
      if (mode === "replace" && crop) {
        data.set("file", await exportProfileCrop(crop.image, position));
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "De uitsnede kon niet worden verwerkt.",
      );

      operation.current = false;
      setPreparing(false);
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateProfilePhoto(data);

        if (!result.success) {
          setError(result.error);
          setReloadRequired(Boolean(result.reloadRequired));
          return;
        }

        onSaved(
          result.warning ??
            (mode === "remove"
              ? "Je profielfoto is verwijderd."
              : "Je profielfoto is opgeslagen."),
        );
      } catch {
        setError(
          "We konden niet bevestigen of je foto is opgeslagen. Laad de pagina opnieuw.",
        );
        setReloadRequired(true);
      } finally {
        operation.current = false;
      }
    });

    setPreparing(false);
  }

  return (
    <ResponsiveDialog
      open
      onClose={() => {
        if (!operation.current) onClose();
      }}
      title="Je profielfoto"
      description="Versleep je foto en zoom in voor de juiste uitsnede."
      busy={busy}
      size="small"
      footer={
        <ActionGroup>
          <ActionButton
            icon="close"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuleren
          </ActionButton>

          {reloadRequired ? (
            <ActionButton
              icon="undo"
              variant="primary"
              onClick={() => window.location.reload()}
            >
              Pagina herladen
            </ActionButton>
          ) : (
            <ActionButton
              icon="save"
              variant="primary"
              loading={busy}
              disabled={mode === "keep"}
              onClick={save}
            >
              Opslaan
            </ActionButton>
          )}
        </ActionGroup>
      }
    >
      <div className={styles.preview}>
        {crop && mode === "replace" ? (
          <CropCanvas
            key={crop.source}
            crop={crop}
            position={position}
            onChange={setPosition}
            disabled={disabled}
          />
        ) : (
          <>
            <Avatar
              name={name}
              source={mode === "remove" ? null : photoSource}
            />
            <p>
              {preparing ? "Foto verwerken…" : "Zo ziet je profielfoto eruit."}
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Profielfoto kiezen"
        className={styles.fileInput}
        disabled={disabled}
        onChange={choose}
      />

      <div className={styles.actions}>
        <ActionButton
          icon="plus"
          variant="glass"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Foto kiezen
        </ActionButton>

        {photoSource && !crop && mode === "keep" && (
          <ActionButton
            icon="edit"
            variant="glass"
            disabled={disabled}
            onClick={editCurrent}
          >
            Bijsnijden
          </ActionButton>
        )}

        {(photoUrl || crop) && mode !== "remove" && (
          <ActionButton
            icon="trash"
            variant="ghost"
            danger
            disabled={disabled}
            onClick={() => {
              setCrop(null);
              setMode(photoUrl ? "remove" : "keep");
              setError("");
            }}
          >
            Verwijderen
          </ActionButton>
        )}

        {mode !== "keep" && (
          <ActionButton
            icon="undo"
            variant="ghost"
            disabled={disabled}
            onClick={reset}
          >
            Wijziging terugzetten
          </ActionButton>
        )}
      </div>

      <p className={styles.hint}>
        JPEG, PNG of WebP · maximaal 20 MB. We slaan alleen je gekozen uitsnede
        op. Je wijziging wordt pas bewaard wanneer je opslaat.
      </p>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </ResponsiveDialog>
  );
}
