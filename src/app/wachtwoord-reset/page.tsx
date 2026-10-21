"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import LoadingState from "@/components/loading-state";
import styles from "../login/page.module.css";

export default function PasswordResetPage() {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Wachtwoordreset laden…"
          description="We zetten het formulier voor je klaar."
        />
      }
    >
      <PasswordResetRoute />
    </Suspense>
  );
}

function PasswordResetRoute() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invalidLink = searchParams.has("error");
  const requestedNext = searchParams.get("next");

  const destination =
    requestedNext && /^\/uitnodiging\/[a-f0-9]{64}$/.test(requestedNext)
      ? requestedNext
      : "/";

  return (
    <PasswordResetForm
      key={JSON.stringify([token, invalidLink, destination])}
      token={token}
      invalidLink={invalidLink}
      destination={destination}
    />
  );
}

function PasswordResetForm({
  token,
  invalidLink,
  destination,
}: {
  token: string | null;
  invalidLink: boolean;
  destination: string;
}) {
  const resetMode = Boolean(token) && !invalidLink;

  const loginHref =
    destination === "/"
      ? "/login"
      : `/login?next=${encodeURIComponent(destination)}`;

  const requestHref =
    destination === "/"
      ? "/wachtwoord-reset"
      : `/wachtwoord-reset?next=${encodeURIComponent(destination)}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || completed || invalidLink) return;

    setError("");

    if (resetMode && password !== confirmation) {
      setError("De wachtwoorden komen niet overeen.");
      return;
    }

    setBusy(true);

    try {
      if (resetMode && token) {
        const result = await authClient.resetPassword({
          token,
          newPassword: password,
        });

        if (result.error) {
          setError(
            "Je wachtwoord kon niet worden gewijzigd. De link kan verlopen of al gebruikt zijn. Vraag dan een nieuwe aan.",
          );
          return;
        }

        setPassword("");
        setConfirmation("");
        setCompleted(true);

        window.location.replace(loginHref);
        return;
      }

      const redirectTo = new URL("/wachtwoord-reset", window.location.origin);

      if (destination !== "/") {
        redirectTo.searchParams.set("next", destination);
      }

      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: redirectTo.toString(),
      });

      if (result.error) {
        setError(
          "De aanvraag kon niet worden verwerkt. Probeer het later opnieuw.",
        );
        return;
      }

      setCompleted(true);
    } catch {
      setError("Verbinding mislukt. Probeer het opnieuw.");
    } finally {
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
          {completed && resetMode
            ? "Wachtwoord gewijzigd."
            : resetMode
              ? "Kies je nieuwe wachtwoord."
              : "Wachtwoord vergeten?"}
        </h1>

        {invalidLink ? (
          <p role="alert" className={styles.subtitle}>
            Deze resetlink is ongeldig of verlopen. Vraag een nieuwe link aan.
          </p>
        ) : completed ? (
          <p role="status" className={styles.subtitle}>
            {resetMode
              ? "Je wordt doorgestuurd naar het inlogscherm."
              : "Als dit e-mailadres bij een account hoort, ontvang je een resetlink. Controleer ook je spammap. De link is 30 minuten geldig."}
          </p>
        ) : (
          <>
            <p className={styles.subtitle}>
              {resetMode
                ? "Gebruik minstens 12 tekens voor je nieuwe wachtwoord."
                : "Vul het e-mailadres van je account in. We sturen je een link om je wachtwoord opnieuw in te stellen."}
            </p>

            <form onSubmit={submit} className={styles.form}>
              <fieldset disabled={busy} className={styles.fields}>
                {resetMode ? (
                  <>
                    <div className={styles.field}>
                      <label htmlFor="new-password">Nieuw wachtwoord</label>
                      <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={12}
                        maxLength={128}
                        required
                      />
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="confirm-password">
                        Herhaal je nieuwe wachtwoord
                      </label>
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                        minLength={12}
                        maxLength={128}
                        required
                      />
                    </div>
                  </>
                ) : (
                  <div className={styles.field}>
                    <label htmlFor="reset-email">E-mailadres</label>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                )}

                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}

                <button type="submit" className={styles.submit}>
                  {busy
                    ? "Even geduld…"
                    : resetMode
                      ? "Wachtwoord opslaan"
                      : "Resetlink aanvragen"}
                </button>
              </fieldset>
            </form>
          </>
        )}

        {!busy && (invalidLink || (resetMode && error)) && (
          <p>
            <Link href={requestHref} className={styles.switchMode}>
              Nieuwe resetlink aanvragen
            </Link>
          </p>
        )}

        {!busy && (
          <p>
            <Link href={loginHref} className={styles.switchMode}>
              Terug naar inloggen
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
