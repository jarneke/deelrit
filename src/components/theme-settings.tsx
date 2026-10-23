"use client";

import { useId, useState, useSyncExternalStore } from "react";
import styles from "./theme-settings.module.css";

type ThemePreference = "light" | "dark" | "system";

const options: {
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

function getSnapshot(): ThemePreference | null {
  const preference = document.documentElement.getAttribute(
    "data-theme-preference",
  );

  if (
    preference === "light" ||
    preference === "dark" ||
    preference === "system"
  ) {
    return preference;
  }

  return null;
}

function getServerSnapshot(): ThemePreference | null {
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
    getSnapshot,
    getServerSnapshot,
  );
  const [saveError, setSaveError] = useState(false);

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

    setSaveError(failed);
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Weergave</h2>

      <p className={styles.description}>Kies hoe Deelrit eruitziet.</p>

      <fieldset
        className={styles.fieldset}
        disabled={preference === null}
        aria-describedby={`${id}-hint`}
      >
        <legend className={styles.visuallyHidden}>Kleurthema</legend>

        <div className={styles.options}>
          {options.map((option) => (
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
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    focusable="false"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                </span>

                <ThemeIcon theme={option.value} />

                <span>{option.label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p id={`${id}-hint`} className={styles.hint}>
        Automatisch volgt de instelling van je apparaat.
      </p>

      <p className={styles.storageHint}>
        Je keuze wordt op dit apparaat bewaard.
      </p>

      {saveError ? (
        <p className={styles.error} role="status">
          Je thema is aangepast, maar je browser kon de keuze niet bewaren. Na
          opnieuw laden geldt mogelijk weer de apparaatinstelling.
        </p>
      ) : null}
    </section>
  );
}
