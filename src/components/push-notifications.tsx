"use client";

import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushStatus,
  sendPushTest,
} from "@/actions/push-notifications";
import styles from "./push-notifications.module.css";

function keyBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = window.atob(
    (value + padding).replace(/-/g, "+").replace(/_/g, "/"),
  );
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return bytes.buffer;
}

function matchingKey(
  subscription: PushSubscription,
  expected: ArrayBuffer,
): boolean {
  const current = subscription.options.applicationServerKey;

  if (!current) {
    return false;
  }

  const left = new Uint8Array(current);
  const right = new Uint8Array(expected);

  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export default function PushNotifications() {
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null,
  );
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Meldingen controleren…");

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let active = true;

    async function initialise() {
      try {
        const ios =
          /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true;

        if (ios && !standalone) {
          if (active) {
            setNeedsInstall(true);
            setMessage(
              "Open Deelrit via je beginscherm om meldingen in te schakelen.",
            );
          }

          return;
        }

        if (
          !window.isSecureContext ||
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window)
        ) {
          if (active) {
            setMessage("Pushmeldingen zijn in deze browser niet beschikbaar.");
          }

          return;
        }

        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        const ready = await navigator.serviceWorker.ready;
        const current = await ready.pushManager.getSubscription();

        if (!active) {
          return;
        }

        setRegistration(ready);
        setSubscription(current);

        if (Notification.permission === "denied") {
          setMessage(
            "Meldingen zijn geblokkeerd. Sta ze toe via je toestelinstellingen.",
          );
          return;
        }

        if (!current) {
          setMessage("Meldingen staan uit op dit toestel.");
          return;
        }

        const result = await getPushStatus(current.endpoint);

        if (!active) {
          return;
        }

        if (!result.success) {
          setMessage(result.error);
          return;
        }

        const isEnabled = result.enabled === true;
        setEnabled(isEnabled);
        setMessage(
          isEnabled
            ? "Meldingen staan aan voor dit account op dit toestel."
            : "Schakel meldingen in om dit toestel aan je account te koppelen.",
        );
      } catch {
        if (active) {
          setMessage(
            "Meldingen controleren is mislukt. Herlaad de pagina om opnieuw te proberen.",
          );
        }
      } finally {
        if (active) {
          setChecked(true);
        }
      }
    }

    void initialise();

    return () => {
      active = false;
    };
  }, []);

  async function enable() {
    if (!registration || !publicKey || busy) {
      return;
    }

    setBusy(true);

    try {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setMessage(
          permission === "denied"
            ? "Meldingen zijn geblokkeerd. Sta ze toe via je toestelinstellingen."
            : "Je hebt nog geen toestemming gegeven.",
        );
        return;
      }

      const expectedKey = keyBuffer(publicKey);
      let current = await registration.pushManager.getSubscription();

      if (current && !matchingKey(current, expectedKey)) {
        const removed = await current.unsubscribe();

        if (!removed) {
          throw new Error("Oude registratie kon niet worden verwijderd.");
        }

        current = null;
        setSubscription(null);
        setEnabled(false);
      }

      const next =
        current ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKey,
        }));

      setSubscription(next);

      const result = await enablePush(next.toJSON());

      if (!result.success) {
        setMessage(result.error);
        return;
      }

      setEnabled(true);
      setMessage("Meldingen staan aan voor dit account op dit toestel.");
    } catch {
      setMessage(
        "Meldingen inschakelen is niet gelukt. Controleer je verbinding en probeer opnieuw.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription || busy) {
      return;
    }

    setBusy(true);

    try {
      const result = await disablePush(subscription.endpoint);

      if (!result.success) {
        setMessage(result.error);
        return;
      }

      setEnabled(false);

      const removed = await subscription.unsubscribe();

      if (!removed) {
        setMessage(
          "Meldingen zijn voor dit account uitgezet. De toestelregistratie kon nog niet worden verwijderd; probeer opnieuw.",
        );
        return;
      }

      setSubscription(null);
      setMessage("Meldingen staan uit op dit toestel.");
    } catch {
      setMessage(
        "Uitschakelen kon niet volledig worden afgerond. Probeer opnieuw.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!subscription || !enabled || busy) {
      return;
    }

    setBusy(true);

    try {
      const result = await sendPushTest(subscription.endpoint);

      setMessage(
        result.success
          ? "De test is verstuurd. Controleer je meldingen."
          : result.error,
      );
    } catch {
      setMessage("De testmelding kon niet worden verstuurd. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="push-title">
      <h2 id="push-title">Meldingen</h2>

      <p className={styles.description}>
        Kies of je op dit toestel meldingen van Deelrit wilt ontvangen.
      </p>

      {needsInstall ? (
        <ol className={styles.instructions}>
          <li>Open Deelrit in Safari.</li>
          <li>Kies Deel → Zet op beginscherm.</li>
          <li>Open Deelrit via het icoon op je beginscherm.</li>
          <li>Ga naar Mijn account en schakel meldingen in.</li>
        </ol>
      ) : (
        <div className={styles.actions}>
          {!enabled && (
            <button
              type="button"
              className={styles.primary}
              onClick={enable}
              disabled={!checked || !registration || !publicKey || busy}
            >
              Meldingen inschakelen
            </button>
          )}

          {enabled && (
            <button
              type="button"
              className={styles.primary}
              onClick={test}
              disabled={busy}
            >
              Testmelding sturen
            </button>
          )}

          {subscription && (
            <button
              type="button"
              className={styles.secondary}
              onClick={disable}
              disabled={busy}
            >
              Meldingen uitschakelen
            </button>
          )}
        </div>
      )}

      <p className={styles.status} role="status" aria-live="polite">
        {busy ? "Even geduld…" : message}
      </p>

      {checked && registration && !publicKey && (
        <p className={styles.status}>
          Meldingen zijn nog niet beschikbaar. Probeer later opnieuw.
        </p>
      )}
    </section>
  );
}
