"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import ActionButton from "./action-button";
import styles from "./logout-button.module.css";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError("Uitloggen is niet gelukt. Probeer opnieuw.");
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError("Verbinding mislukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.container}>
      <ActionButton
        icon="logout"
        variant="secondary"
        onClick={logout}
        loading={busy}
      >
        {busy ? "Uitloggen…" : "Uitloggen"}
      </ActionButton>

      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
