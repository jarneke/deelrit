"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "./logout-button.module.css";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
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
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className={styles.button}
      >
        {busy ? "Even geduld…" : "Uitloggen"}
      </button>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
