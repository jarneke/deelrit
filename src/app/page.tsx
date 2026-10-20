import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import CarGroups from "@/components/car-groups";
import styles from "./page.module.css";

export default function Home() {
  return (
    <Suspense fallback={<p>Auto’s laden…</p>}>
      <MyCars />
    </Suspense>
  );
}

async function MyCars() {
  const session = await requireSession();

  const organizations = await auth.api.listOrganizations({
    headers: await headers(),
  });

  const initials =
    session.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  const cars = organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    licensePlate: organization.licensePlate ?? null,
  }));

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <span className={styles.logo}>
            deel<span>rit.</span>
          </span>

          <Link
            href="/account"
            className={styles.avatar}
            aria-label={`Account van ${session.user.name}`}
          >
            {initials}
          </Link>
        </header>

        <p className={styles.welcome}>Welkom, {session.user.name}</p>

        <h1 className={styles.title}>Mijn auto’s.</h1>

        <p className={styles.subtitle}>
          Elke auto heeft zijn eigen groep, ritten en afrekening.
        </p>

        <CarGroups cars={cars} />
      </div>
    </main>
  );
}
