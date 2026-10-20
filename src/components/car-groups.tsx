"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "./car-groups.module.css";
import linkStyles from "./car-link.module.css";

type Car = {
  id: string;
  name: string;
  licensePlate: string | null;
};

type Props = {
  cars: Car[];
};

export default function CarGroups({ cars }: Props) {
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createCar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const cleanName = name.trim();
    const cleanPlate = licensePlate.trim().toUpperCase();

    if (!cleanName) {
      setError("Geef je auto een naam.");
      return;
    }

    setBusy(true);

    try {
      const result = await authClient.organization.create({
        name: cleanName,
        slug: `auto-${crypto.randomUUID()}`,
        ...(cleanPlate ? { licensePlate: cleanPlate } : {}),
      });

      if (result.error || !result.data) {
        setError("De auto kon niet worden toegevoegd. Probeer opnieuw.");
        return;
      }

      setName("");
      setLicensePlate("");
      setShowForm(false);
      setNotice(`${cleanName} is toegevoegd. Jij bent de eigenaar.`);
      router.refresh();
    } catch {
      setError("Verbinding mislukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setShowForm(false);
    setName("");
    setLicensePlate("");
    setError("");
  }

  return (
    <div className={styles.content}>
      <div className={styles.toolbar}>
        <p className={styles.count}>
          {cars.length === 1 ? "1 auto" : `${cars.length} auto’s`}
        </p>

        {!showForm && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setShowForm(true);
              setNotice("");
            }}
          >
            + Auto toevoegen
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {showForm && (
        <section className={styles.formPanel}>
          <h2 className={styles.sectionTitle}>Een auto toevoegen</h2>

          <p className={styles.description}>
            Je maakt een aparte groep voor deze auto.
          </p>

          <form onSubmit={createCar}>
            <fieldset disabled={busy} className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="car-name">Autonaam</label>
                <input
                  id="car-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Bijvoorbeeld: Onze Clio"
                  required
                  maxLength={80}
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="license-plate">Nummerplaat · optioneel</label>
                <input
                  id="license-plate"
                  value={licensePlate}
                  onChange={(event) => setLicensePlate(event.target.value)}
                  placeholder="Bijvoorbeeld: 1-ABC-123"
                  maxLength={20}
                  autoCapitalize="characters"
                />
              </div>

              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}

              <div className={styles.formActions}>
                <button type="submit" className={styles.primary}>
                  {busy ? "Toevoegen…" : "Auto toevoegen"}
                </button>

                <button
                  type="button"
                  onClick={cancel}
                  className={styles.secondary}
                >
                  Annuleren
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}

      {cars.length === 0 ? (
        <section className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            ↔
          </span>
          <h2>Nog geen gedeelde auto.</h2>
          <p>
            Voeg je eerste auto toe. Hier verschijnen ook de auto’s waarvoor je
            een uitnodiging aanvaardt.
          </p>
        </section>
      ) : (
        <div className={styles.grid}>
          {cars.map((car) => (
            <Link
              key={car.id}
              href={`/auto/${encodeURIComponent(car.id)}`}
              className={`${styles.car} ${linkStyles.link}`}
            >
              <div className={styles.carTop}>
                <span className={styles.carIcon} aria-hidden="true">
                  ↔
                </span>
                <span className={styles.badge}>Autogroep</span>
              </div>

              <h2>{car.name}</h2>

              <p className={styles.plate}>
                {car.licensePlate || "Geen nummerplaat ingevuld"}
              </p>

              <p className={styles.carHint}>Bekijk deze auto →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
