"use client";

import { useId, useState, useSyncExternalStore } from "react";
import GlassSurface from "./glass-surface";
import styles from "./theme-settings.module.css";

type ThemePreference = "light" | "dark" | "system";
type AccentPreference = "silver" | `#${string}`;

const themeOptions: {
  value: ThemePreference;
  label: string;
}[] = [
  { value: "light", label: "Licht" },
  { value: "dark", label: "Donker" },
  { value: "system", label: "Automatisch" },
];

function subscribe(onChange: () => void) {
  window.addEventListener("deelrit:theme-applied", onChange);

  return () => {
    window.removeEventListener("deelrit:theme-applied", onChange);
  };
}

function getThemeSnapshot(): ThemePreference | null {
  const value = document.documentElement.getAttribute("data-theme-preference");

  return value === "light" || value === "dark" || value === "system"
    ? value
    : null;
}

function getAccentSnapshot(): AccentPreference | null {
  const value = document.documentElement.getAttribute("data-accent");

  if (value === "silver") {
    return value;
  }

  if (value !== null && /^#[0-9a-f]{6}$/i.test(value)) {
    return value as AccentPreference;
  }

  return null;
}

function getServerSnapshot(): null {
  return null;
}

function normalizeHex(value: string): `#${string}` | null {
  const trimmed = value.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .split("")
      .map((character) => character + character)
      .join("")
      .toLowerCase()}`;
  }

  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }

  return null;
}

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
        </>
      ) : theme === "dark" ? (
        <path d="M20.5 13.1A8.8 8.8 0 0 1 10.9 3.5 8.8 8.8 0 1 0 20.5 13.1Z" />
      ) : (
        <>
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M10 18h4" />
        </>
      )}
    </svg>
  );
}

export default function ThemeSettings() {
  const id = useId();

  const preference = useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerSnapshot,
  );

  const accent = useSyncExternalStore(
    subscribe,
    getAccentSnapshot,
    getServerSnapshot,
  );

  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [hexError, setHexError] = useState(false);

  const [storageErrors, setStorageErrors] = useState({
    theme: false,
    accent: false,
  });

  const pickerColor =
    accent === null || accent === "silver" ? "#bfc4cc" : accent;

  const hexValue = hexDraft ?? pickerColor;

  function selectTheme(value: ThemePreference) {
    let failed = false;

    try {
      window.localStorage.setItem("deelrit-theme", value);
    } catch {
      failed = true;
    }

    window.dispatchEvent(
      new CustomEvent<ThemePreference>("deelrit:theme-change", {
        detail: value,
      }),
    );

    setStorageErrors((current) => ({
      ...current,
      theme: failed,
    }));
  }

  function selectAccent(value: AccentPreference) {
    let failed = false;

    try {
      window.localStorage.setItem("deelrit-accent", value);
    } catch {
      failed = true;
    }

    window.dispatchEvent(
      new CustomEvent<AccentPreference>("deelrit:accent-change", {
        detail: value,
      }),
    );

    setStorageErrors((current) => ({
      ...current,
      accent: failed,
    }));

    setHexDraft(null);
    setHexError(false);
  }

  function applyHex() {
    const normalized = normalizeHex(hexValue);

    if (normalized === null) {
      setHexError(true);
      return;
    }

    selectAccent(normalized);
  }

  return (
    <GlassSurface
      as="section"
      className={styles.panel}
      aria-labelledby={`${id}-heading`}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>Maak het persoonlijk</p>
        <h2 id={`${id}-heading`}>Jouw Deelrit</h2>

        <p className={styles.description}>
          Een rustige basis in wit, zwart en zilver. Kies het thema en accent
          dat bij jou passen.
        </p>
      </header>

      <fieldset
        className={styles.fieldset}
        disabled={preference === null}
        aria-describedby={`${id}-theme-hint`}
      >
        <legend className={styles.legend}>Weergave</legend>

        <div className={styles.options}>
          {themeOptions.map((option) => (
            <label key={option.value} className={styles.option}>
              <input
                className={styles.radio}
                type="radio"
                name={`${id}-theme`}
                value={option.value}
                checked={preference === option.value}
                onChange={() => selectTheme(option.value)}
              />

              <span className={styles.optionContent}>
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>

                <ThemeIcon theme={option.value} />
                <span>{option.label}</span>
              </span>
            </label>
          ))}
        </div>

        <p id={`${id}-theme-hint`} className={styles.hint}>
          Automatisch volgt de instelling van je apparaat.
        </p>
      </fieldset>

      <fieldset
        className={`${styles.fieldset} ${styles.accentFieldset}`}
        disabled={accent === null}
        aria-describedby={`${id}-accent-hint`}
      >
        <legend className={styles.legend}>Accentkleur</legend>

        <div className={styles.colorControls}>
          <div className={styles.pickerField}>
            <label htmlFor={`${id}-picker`} className={styles.inputLabel}>
              Kleurkiezer
            </label>

            <input
              id={`${id}-picker`}
              className={styles.colorPicker}
              type="color"
              value={pickerColor}
              onChange={(event) => {
                const normalized = normalizeHex(event.target.value);

                if (normalized !== null) {
                  selectAccent(normalized);
                }
              }}
            />
          </div>

          <div className={styles.hexField}>
            <label htmlFor={`${id}-hex`} className={styles.inputLabel}>
              Hexcode
            </label>

            <input
              id={`${id}-hex`}
              className={styles.hexInput}
              type="text"
              value={hexValue}
              maxLength={7}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="#466ba8"
              aria-invalid={hexError}
              aria-describedby={
                hexError ? `${id}-hex-error` : `${id}-accent-hint`
              }
              onChange={(event) => {
                setHexDraft(event.target.value);
                setHexError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyHex();
                }
              }}
            />
          </div>

          <button
            type="button"
            className={styles.applyButton}
            onClick={applyHex}
          >
            Toepassen
          </button>
        </div>

        {hexError ? (
          <p id={`${id}-hex-error`} className={styles.error} role="alert">
            Vul een geldige kleurcode in, bijvoorbeeld #466ba8 of #abc.
          </p>
        ) : null}

        <div className={styles.accentSummary}>
          <span className={styles.currentAccent}>
            {accent === null
              ? "Kleur laden…"
              : accent === "silver"
                ? "Standaard zilver"
                : `Eigen kleur · ${accent.toUpperCase()}`}
          </span>

          <button
            type="button"
            className={styles.resetButton}
            disabled={accent === "silver" && hexDraft === null}
            onClick={() => selectAccent("silver")}
          >
            Terug naar zilver
          </button>
        </div>

        <p id={`${id}-accent-hint`} className={styles.hint}>
          Kies vrij een kleur. Tekst en contrast passen zich aan je thema aan,
          zodat lichte en donkere accenten leesbaar blijven.
        </p>
      </fieldset>

      <div
        className={styles.preview}
        role="img"
        aria-label="Stijlvoorbeeld met je huidige thema en accentkleur"
      >
        <div className={styles.previewHeading}>
          <span className={styles.previewBrand}>deelrit</span>
          <span className={styles.previewLabel}>Voorbeeld</span>
        </div>

        <div className={styles.previewBody}>
          <span className={styles.previewOrb} aria-hidden="true" />

          <GlassSurface className={styles.previewGlass}>
            <span className={styles.previewTitle}>Samen onderweg.</span>
            <span className={styles.previewText}>Jouw thema. Jouw accent.</span>
          </GlassSurface>
        </div>

        <div className={styles.previewFooter}>
          <span className={styles.previewStatus}>
            <span aria-hidden="true" />
            Overzicht
          </span>

          <span className={styles.previewAction}>+ Rit toevoegen</span>
        </div>
      </div>

      <p className={styles.storageHint}>
        Je keuzes worden in deze browser bewaard en gelden voor alle schermen
        van Deelrit.
      </p>

      {storageErrors.theme || storageErrors.accent ? (
        <p className={styles.error} role="status">
          Je weergave is aangepast, maar je browser kon niet alle keuzes
          bewaren. Na opnieuw laden kunnen die terugvallen op de
          standaardinstellingen.
        </p>
      ) : null}
    </GlassSurface>
  );
}
