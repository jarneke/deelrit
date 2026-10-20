"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createInvitationLink,
  revokeInvitationLink,
} from "@/actions/invitation-links";
import styles from "./invitation-links.module.css";

type Invitation = {
  id: string;
  expiresAt: string;
};

type Props = {
  organizationId: string;
  invitations: Invitation[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("nl-BE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(new Date(value));
}

export default function InvitationLinks({
  organizationId,
  invitations,
}: Props) {
  const router = useRouter();

  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createLink() {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const result = await createInvitationLink(organizationId);

      if (!result.success) {
        setError(result.error);
        return;
      }

      setLink(new URL(result.path, window.location.origin).toString());
      setNotice("Uitnodigingslink gemaakt.");
      router.refresh();
    } catch {
      setError("De link kon niet worden gemaakt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    setError("");
    setNotice("");

    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link gekopieerd.");
    } catch {
      setNotice("Kopiëren is niet gelukt. Selecteer en kopieer de link.");
    }
  }

  async function shareLink() {
    setError("");
    setNotice("");

    const shareData = {
      title: "Uitnodiging voor Deelrit",
      text: "Deel je deze auto met mij? Open de link om deel te nemen.",
      url: link,
    };

    if (
      typeof navigator.share !== "function" ||
      (typeof navigator.canShare === "function" &&
        !navigator.canShare(shareData))
    ) {
      await copyLink();
      return;
    }

    setSharing(true);

    try {
      await navigator.share(shareData);
    } catch (shareError) {
      if (
        shareError instanceof DOMException &&
        shareError.name === "AbortError"
      ) {
        return;
      }

      setNotice("Delen is niet gelukt. Je kunt de link ook kopiëren.");
    } finally {
      setSharing(false);
    }
  }

  async function revokeLink(id: string) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const result = await revokeInvitationLink(id);

      if (!result.success) {
        setError(result.error);
        return;
      }

      setLink("");
      setNotice("Uitnodiging ingetrokken.");
      router.refresh();
    } catch {
      setError("Intrekken is niet gelukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>Deel deze auto</h2>
          <p>
            Nodig iemand uit met een eenmalige link. De link is 24 uur geldig.
          </p>
        </div>

        <button
          type="button"
          className={styles.primary}
          onClick={createLink}
          disabled={busy || sharing}
        >
          {busy ? "Even geduld…" : "+ Uitnodigingslink"}
        </button>
      </div>

      {link && (
        <div className={styles.linkPanel}>
          <label htmlFor="invitation-link">Jouw uitnodigingslink</label>

          <div className={styles.linkRow}>
            <input
              id="invitation-link"
              value={link}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />

            <button
              type="button"
              className={styles.primary}
              onClick={shareLink}
              disabled={busy || sharing}
            >
              {sharing ? "Delen…" : "Delen"}
            </button>

            <button
              type="button"
              className={styles.secondary}
              onClick={copyLink}
              disabled={busy || sharing}
            >
              Kopiëren
            </button>
          </div>

          <p>
            Iedereen met deze link kan als lid deelnemen. Kopieer of deel hem
            voordat je deze pagina verlaat.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      <h3 className={styles.listTitle}>Openstaande uitnodigingen</h3>

      {invitations.length === 0 ? (
        <p className={styles.empty}>Geen openstaande uitnodigingen.</p>
      ) : (
        <ul className={styles.list}>
          {invitations.map((invitation) => (
            <li key={invitation.id} className={styles.item}>
              <div>
                <p className={styles.itemTitle}>Uitnodigingslink</p>

                <p className={styles.expiry}>
                  Geldig tot {formatDate(invitation.expiresAt)}
                </p>
              </div>

              <button
                type="button"
                className={styles.secondary}
                disabled={busy || sharing}
                onClick={() => revokeLink(invitation.id)}
                aria-label={`Uitnodiging geldig tot ${formatDate(
                  invitation.expiresAt,
                )} intrekken`}
              >
                Intrekken
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
