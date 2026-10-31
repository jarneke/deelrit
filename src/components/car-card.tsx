import Link from "next/link";
import AppIcon from "./app-icon";
import { CarPhoto } from "./car-hero";
import GlassSurface from "./glass-surface";
import styles from "./car-card.module.css";

export type CarCardData = {
  id: string;
  name: string;
  licensePlate: string | null;
  photoSource: string;
};

type Props = CarCardData & {
  eager?: boolean;
};

export default function CarCard({
  id,
  name,
  licensePlate,
  photoSource,
  eager = false,
}: Props) {
  return (
    <Link
      href={"/auto/" + encodeURIComponent(id)}
      className={styles.card}
      aria-label={"Open " + name}
    >
      <div className={styles.visual}>
        <CarPhoto src={photoSource} alt="" eager={eager} />
        <div className={styles.fade} aria-hidden="true" />

        <GlassSurface className={styles.badge}>
          <AppIcon name="users" size={15} />
          Gedeelde auto
        </GlassSurface>
      </div>

      <div className={styles.body}>
        <h2>{name}</h2>

        <p className={styles.plate}>
          {licensePlate || "Geen nummerplaat ingevuld"}
        </p>

        <div className={styles.footer}>
          <span>Open auto</span>

          <GlassSurface className={styles.arrow} aria-hidden="true">
            <AppIcon name="arrow-right" size={20} />
          </GlassSurface>
        </div>
      </div>
    </Link>
  );
}
