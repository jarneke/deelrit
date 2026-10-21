"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import LoadingState from "@/components/loading-state";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Inloggen laden…"
          description="We zetten het inlogscherm voor je klaar."
        />
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");

  const destination =
    requestedNext && /^\/uitnodiging\/[a-f0-9]{64}$/.test(requestedNext)
      ? requestedNext
      : "/";

  const resetHref =
    destination === "/"
      ? "/wachtwoord-reset"
      : `/wachtwoord-reset?next=${encodeURIComponent(destination)}`;

  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");
    setBusy(true);

    try {
      const result = register
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
          });

      if (result.error) {
        setError(
          register
            ? "Registreren is niet gelukt. Controleer je gegevens."
            : "Inloggen is niet gelukt. Controleer je e-mail en wachtwoord.",
        );
        setBusy(false);
        return;
      }

      router.replace(destination);
      router.refresh();
    } catch {
      setError("Verbinding mislukt. Probeer het opnieuw.");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <p className={styles.logo}>
          deel<span>rit.</span>
        </p>

        <h1 className={styles.title}>
          {register ? "Maak je account." : "Welkom terug."}
        </h1>

        <p className={styles.subtitle}>
          {destination !== "/"
            ? "Log in of maak een account om je uitnodiging te bekijken."
            : "Eén account voor al je gedeelde auto’s."}
        </p>

        <form onSubmit={submit} className={styles.form}>
          <fieldset disabled={busy} className={styles.fields}>
            {register && (
              <div className={styles.field}>
                <label htmlFor="name">Je naam</label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  maxLength={100}
                  pattern=".*\S.*"
                />
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="email">E-mailadres</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Wachtwoord</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={register ? "new-password" : "current-password"}
                minLength={12}
                maxLength={128}
                required
              />

              {register && (
                <p className={styles.hint}>Gebruik minstens 12 tekens.</p>
              )}
            </div>

            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}

            <button type="submit" className={styles.submit}>
              {busy ? "Even geduld…" : register ? "Account maken" : "Inloggen"}
            </button>
          </fieldset>
        </form>

        {!register && !busy && (
          <p>
            <Link href={resetHref} className={styles.switchMode}>
              Wachtwoord vergeten?
            </Link>
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setError("");
            setPassword("");
          }}
          className={styles.switchMode}
        >
          {register ? "Al een account? Log in" : "Nog geen account? Registreer"}
        </button>
      </div>
    </main>
  );
}
