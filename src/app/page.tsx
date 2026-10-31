import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getCarPhotoSource, getProfilePhotoSource } from "@/lib/github-images";
import UserAvatar from "@/components/user-avatar";
import CarGroups from "@/components/car-groups";
import LoadingState from "@/components/loading-state";
import { GlassScope } from "@/components/glass-surface";
import styles from "./page.module.css";

export default function Home() {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Je auto’s laden…"
          description="We halen je gedeelde auto’s op."
        />
      }
    >
      <MyCars />
    </Suspense>
  );
}

async function MyCars() {
  const session = await requireSession();

  const organizations = await auth.api.listOrganizations({
    headers: await headers(),
  });

  const profile = await db.query<{ image: string | null }>(
    'SELECT image FROM public."user" WHERE id = $1',
    [session.user.id],
  );

  const avatarSource = getProfilePhotoSource(
    session.user.id,
    profile.rows[0]?.image ?? null,
  );

  const cars = organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    licensePlate: organization.licensePlate ?? null,
    photoSource: getCarPhotoSource(organization.id, organization.logo ?? null),
  }));

  return (
    <main className={styles.page}>
      <GlassScope className={styles.container}>
        <header className={styles.header}>
          <span className={styles.logo}>
            deelrit<span>.</span>
          </span>

          <Link
            data-glass
            href="/account"
            className={styles.profileLink}
            aria-label={"Account van " + session.user.name}
          >
            <span className={styles.profileLabel}>Mijn profiel</span>

            <span className={styles.avatar}>
              <UserAvatar name={session.user.name} source={avatarSource} />
            </span>
          </Link>
        </header>

        <div className={styles.introduction}>
          <p className={styles.welcome}>Welkom, {session.user.name}</p>

          <h1 className={styles.title}>
            Mijn auto’s<span>.</span>
          </h1>

          <p className={styles.subtitle}>
            Jullie auto’s, ritten en kosten. Alles op één plek.
          </p>
        </div>

        <CarGroups cars={cars} />
      </GlassScope>
    </main>
  );
}
