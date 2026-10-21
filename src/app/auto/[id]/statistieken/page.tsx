import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import {
  loadCarStatistics,
  StatisticsAccessError,
} from "@/lib/car-statistics-data";
import { logServerError } from "@/lib/server-error";
import CarStatistics from "@/components/car-statistics";
import LoadingState from "@/components/loading-state";
import styles from "@/components/car-statistics.module.css";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "Statistieken | Deelrit",
};

export default function StatisticsPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Je statistieken laden…"
          description="We berekenen de kilometers, kosten en rijpatronen."
        />
      }
    >
      <StatisticsContent params={params} />
    </Suspense>
  );
}

async function StatisticsContent({ params }: Props) {
  const session = await requireSession();
  const { id } = await params;

  const loaded = await loadCarStatistics(id, session.user.id).catch(
    (error: unknown) => {
      if (error instanceof StatisticsAccessError) notFound();

      logServerError("StatisticsPage", error);

      throw new Error("De statistieken konden niet worden geladen.");
    },
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href={"/auto/" + encodeURIComponent(id)} className={styles.back}>
          ← Terug naar je auto
        </Link>

        <header className={styles.heading}>
          <p className={styles.eyebrow}>
            {loaded.carName}
            {loaded.licensePlate ? " · " + loaded.licensePlate : ""}
          </p>

          <h1>Elke kilometer telt.</h1>

          <p>Je gebruik, rijpatronen en brandstofkosten op één plek.</p>
        </header>

        <CarStatistics key={id} data={loaded.statistics} />
      </div>
    </main>
  );
}
