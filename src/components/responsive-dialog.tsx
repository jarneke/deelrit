"use client";

import {
  useEffect,
  useId,
  useRef,
  type PointerEvent,
  type ReactNode,
} from "react";
import ActionButton from "./action-button";
import GlassSurface from "./glass-surface";
import styles from "./responsive-dialog.module.css";

type Props = {
  id?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  size?: "small" | "medium" | "large";
  dismissOnBackdrop?: boolean;
};

type SavedProperty = {
  name: string;
  value: string;
  priority: string;
};

let scrollLocks = 0;
let restoreScroll: (() => void) | null = null;

function saveProperties(
  element: HTMLElement,
  names: string[],
): SavedProperty[] {
  return names.map((name) => ({
    name,
    value: element.style.getPropertyValue(name),
    priority: element.style.getPropertyPriority(name),
  }));
}

function restoreProperties(element: HTMLElement, properties: SavedProperty[]) {
  for (const property of properties) {
    if (property.value) {
      element.style.setProperty(
        property.name,
        property.value,
        property.priority,
      );
    } else {
      element.style.removeProperty(property.name);
    }
  }
}

function lockPageScroll() {
  if (scrollLocks === 0) {
    const root = document.documentElement;
    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);

    const paddingRight =
      Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;

    const rootProperties = saveProperties(root, ["overflow"]);

    const bodyProperties = saveProperties(body, [
      "position",
      "top",
      "left",
      "width",
      "overflow",
      "padding-right",
    ]);

    root.style.setProperty("overflow", "hidden");

    body.style.setProperty("position", "fixed");
    body.style.setProperty("top", `${-scrollY}px`);
    body.style.setProperty("left", `${-scrollX}px`);
    body.style.setProperty("width", "100%");
    body.style.setProperty("overflow", "hidden");
    body.style.setProperty(
      "padding-right",
      `${paddingRight + scrollbarWidth}px`,
    );

    restoreScroll = () => {
      const scrollBehavior = saveProperties(root, ["scroll-behavior"]);

      root.style.setProperty("scroll-behavior", "auto", "important");

      restoreProperties(body, bodyProperties);
      restoreProperties(root, rootProperties);

      window.scrollTo(scrollX, scrollY);

      restoreProperties(root, scrollBehavior);
    };
  }

  scrollLocks += 1;
  let released = false;

  return () => {
    if (released) return;

    released = true;
    scrollLocks -= 1;

    if (scrollLocks === 0) {
      restoreScroll?.();
      restoreScroll = null;
    }
  };
}

function isOutside(
  dialog: HTMLDialogElement,
  clientX: number,
  clientY: number,
) {
  const rect = dialog.getBoundingClientRect();

  return (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  );
}

export default function ResponsiveDialog({
  id,
  open,
  onClose,
  title,
  description,
  children,
  footer,
  busy = false,
  size = "medium",
  dismissOnBackdrop = false,
}: Props) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backdropPointer = useRef<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!open || !dialog) return;

    const unlock = lockPageScroll();

    if (!dialog.open) {
      dialog.showModal();
    }

    titleRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) {
        dialog.close();
      }

      unlock();
    };
  }, [open]);

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    backdropPointer.current =
      event.target === event.currentTarget &&
      isOutside(event.currentTarget, event.clientX, event.clientY)
        ? event.pointerId
        : null;
  }

  function handlePointerUp(event: PointerEvent<HTMLDialogElement>) {
    const startedOnBackdrop = backdropPointer.current === event.pointerId;
    backdropPointer.current = null;

    if (
      !busy &&
      dismissOnBackdrop &&
      startedOnBackdrop &&
      event.target === event.currentTarget &&
      isOutside(event.currentTarget, event.clientX, event.clientY)
    ) {
      onClose();
    }
  }

  const classes = [styles.dialog, styles[size]].join(" ");

  return (
    <dialog
      id={id}
      ref={dialogRef}
      className={classes}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();

        if (!busy) {
          onClose();
        }
      }}
      onClose={() => {
        const dialog = dialogRef.current;

        if (open && dialog && !dialog.open) {
          onClose();
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        backdropPointer.current = null;
      }}
    >
      <GlassSurface className={styles.surface}>
        <div className={styles.handle} aria-hidden="true" />

        <header className={styles.header}>
          <div className={styles.heading}>
            <h2 id={titleId} ref={titleRef} tabIndex={-1}>
              {title}
            </h2>

            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>

          <ActionButton
            icon="close"
            iconOnly
            label="Sluiten"
            variant="ghost"
            className={styles.close}
            disabled={busy}
            onClick={onClose}
          />
        </header>

        <div className={styles.body}>{children}</div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </GlassSurface>
    </dialog>
  );
}
