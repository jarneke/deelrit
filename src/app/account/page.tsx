import { Suspense } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import LogoutButton from "@/components/logout-button";
import LoadingState from "@/components/loading-state";
import PushNotifications from "@/components/push-notifications";
import styles from "./page.module.css";

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Je account laden…"
          description="We halen je profielgegevens op."
        />
      }
    >
      <Account />
    </Suspense>
  );
}

async function Account() {
  const session = await requireSession();

  const initials =
    session.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.back}>
          ← Terug naar overzicht
        </Link>

        <h1 className={styles.title}>Mijn account.</h1>

        <section className={styles.profile}>
          <div className={styles.avatar} aria-hidden="true">
            {initials}
          </div>

          <div className={styles.identity}>
            <h2>{session.user.name}</h2>
            <p>{session.user.email}</p>
          </div>
        </section>

        <section className={styles.details}>
          <h2>Accountgegevens</h2>

          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>Naam</dt>
              <dd>{session.user.name}</dd>
            </div>

            <div className={styles.row}>
              <dt>E-mailadres</dt>
              <dd>{session.user.email}</dd>
            </div>
          </dl>
        </section>

        <PushNotifications />

        <section className={styles.logout}>
          <div>
            <h2>Uitloggen</h2>
            <p>Beëindig je sessie op dit apparaat.</p>
          </div>

          <LogoutButton />
        </section>
      </div>
    </main>
  );
}
