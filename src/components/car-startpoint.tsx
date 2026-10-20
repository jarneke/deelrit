"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveCarStartpoint } from "@/actions/car-startpoint";
import styles from "./car-startpoint.module.css";

type Startpoint = {
  tankDate: string;
  odometer: number;
};

type Props = {
  organizationId: string;
  isOwner: boolean;
  startpoint: Startpoint | null;
};

export default function CarStartpoint({
  organizationId,
  isOwner,
  startpoint,
}: Props) {
  const router = useRouter();

  const [tankDate, setTankDate] = useState("");
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!odometer.trim()) {
      setError("Vul de kilometerstand in.");
      return;
    }

    setBusy(true);

    try {
      const result = await saveCarStartpoint(
        organizationId,
        tankDate,
        Number(odometer),
      );

      if (!result.success) {
        setError(result.error);
        return;
      }

      router.refresh();
    } catch {
      setError("Opslaan is niet gelukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  if (startpoint) {
    const formattedDate = new Intl.DateTimeFormat("nl-BE", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${startpoint.tankDate}T00:00:00Z`));

    return (
      <section className={styles.summary}>
        <p className={styles.eyebrow}>Startpunt</p>

        <h2 className={styles.odometer}>
          {new Intl.NumberFormat("nl-BE").format(startpoint.odometer)}
          <span> km</span>
        </h2>

        <p className={styles.date}>Volle tank op {formattedDate}</p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <h2>Startpunt instellen</h2>

      {isOwner ? (
        <>
          <p className={styles.description}>
            Vanaf welke volle tank houden jullie de kilometers bij?
          </p>

          <form onSubmit={submit}>
            <fieldset disabled={busy} className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="start-tank-date">Datum volle tank</label>

                <input
                  id="start-tank-date"
                  type="date"
                  value={tankDate}
                  onChange={(event) => setTankDate(event.target.value)}
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="start-odometer">Kilometerstand</label>

                <input
                  id="start-odometer"
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  inputMode="numeric"
                  value={odometer}
                  onChange={(event) => setOdometer(event.target.value)}
                  required
                />
              </div>

              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}

              <button type="submit" className={styles.primary}>
                {busy ? "Opslaan…" : "Startpunt opslaan"}
              </button>
            </fieldset>
          </form>
        </>
      ) : (
        <p className={styles.description}>
          Een eigenaar moet eerst het startpunt van deze auto instellen.
        </p>
      )}
    </section>
  );
}
