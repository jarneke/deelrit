import { Suspense } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getProfilePhotoSource } from "@/lib/github-images";
import ProfilePhoto from "@/components/profile-photo";
import AppIcon from "@/components/app-icon";
import GlassSurface from "@/components/glass-surface";
import LogoutButton from "@/components/logout-button";
import LoadingState from "@/components/loading-state";
import PushNotifications from "@/components/push-notifications";
import ThemeSettings from "@/components/theme-settings";
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

  const profile = await db.query<{ image: string | null }>(
    'SELECT image FROM public."user" WHERE id = $1',
    [session.user.id],
  );

  const photoUrl = profile.rows[0]?.image ?? null;
  const photoSource = getProfilePhotoSource(session.user.id, photoUrl);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link
            href="/"
            className={styles.back}
            aria-label="Terug naar mijn auto’s"
          >
            <AppIcon name="arrow-left" />
            <span>Mijn auto’s</span>
          </Link>

          <Link
            href="/"
            className={styles.brand}
            aria-label="Deelrit — mijn auto’s"
          >
            deelrit<span>.</span>
          </Link>
        </header>

        <div className={styles.introduction}>
          <p className={styles.eyebrow}>Helemaal van jou</p>

          <h1 className={styles.title}>
            Mijn profiel<span>.</span>
          </h1>

          <p className={styles.subtitle}>
            Je gegevens, je voorkeuren en je meldingen.
          </p>
        </div>

        <ProfilePhoto
          key={session.user.id}
          name={session.user.name}
          email={session.user.email}
          photoUrl={photoUrl}
          photoSource={photoSource}
        />

        <div className={styles.layout}>
          <div className={styles.preferences}>
            <ThemeSettings />
          </div>

          <div className={styles.sidebar}>
            <GlassSurface
              as="section"
              tone="solid"
              className={styles.details}
              aria-labelledby="account-details"
            >
              <div className={styles.sectionHeading}>
                <span className={styles.sectionIcon} aria-hidden="true">
                  <AppIcon name="user" size={20} />
                </span>

                <h2 id="account-details">Accountgegevens</h2>
              </div>

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
            </GlassSurface>

            <PushNotifications />

            <GlassSurface
              as="section"
              className={styles.logout}
              aria-labelledby="logout-heading"
            >
              <div>
                <h2 id="logout-heading">Uitloggen</h2>
                <p>Beëindig je sessie op dit apparaat.</p>
              </div>

              <LogoutButton />
            </GlassSurface>
          </div>
        </div>
      </div>
    </main>
  );
}
