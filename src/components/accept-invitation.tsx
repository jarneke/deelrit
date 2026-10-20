"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitationLink } from "@/actions/invitation-links";
import styles from "@/app/uitnodiging/[token]/page.module.css";

type Props = {
  token: string;
};

export default function AcceptInvitation({ token }: Props) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");

    try {
      const result = await acceptInvitationLink(token);

      if (!result.success) {
        setError(result.error);
        setBusy(false);
        return;
      }

      router.replace(`/auto/${result.organizationId}`);
      router.refresh();
    } catch {
      setError("Deelnemen is niet gelukt. Probeer opnieuw.");
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={accept}
        disabled={busy}
        className={styles.primary}
      >
        {busy ? "Deelnemen…" : "Deelnemen"}
      </button>
    </div>
  );
}
