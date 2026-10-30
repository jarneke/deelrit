"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import AppIcon from "./app-icon";
import GlassSurface from "./glass-surface";
import styles from "./car-hero.module.css";

type PhotoProps = {
  src: string;
  alt: string;
  eager?: boolean;
};

export function CarPhoto(props: PhotoProps) {
  return <PhotoImage key={props.src} {...props} />;
}

function PhotoImage({ src, alt, eager = false }: PhotoProps) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.photo}>
      {failed ? (
        <div
          className={styles.unavailable}
          role="img"
          aria-label="Foto niet beschikbaar"
        >
          <AppIcon name="car" size={32} />
          <span>Foto niet beschikbaar</span>
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 960px) 100vw, 960px"
          loading={eager ? "eager" : "lazy"}
          className={styles.image}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

type Props = {
  name: string;
  licensePlate: string | null;
  photoSource: string;
  odometer: number | null;
  memberCount: number;
  tripCount: number;
  actions?: ReactNode;
};

const numbers = new Intl.NumberFormat("nl-BE");

export default function CarHero({
  name,
  licensePlate,
  photoSource,
  odometer,
  memberCount,
  tripCount,
  actions,
}: Props) {
  return (
    <div className={styles.hero}>
      <div className={styles.visual}>
        <CarPhoto src={photoSource} alt={"Foto bij " + name} eager />
        <div className={styles.fade} aria-hidden="true" />

        <GlassSurface className={styles.odometer}>
          <AppIcon name="gauge" size={24} />

          <div>
            <span className={styles.odometerLabel}>Geregistreerde stand</span>

            <strong>
              {odometer === null
                ? "Nog geen startpunt"
                : numbers.format(odometer) + " km"}
            </strong>
          </div>
        </GlassSurface>
      </div>

      <div className={styles.content}>
        <div className={styles.titleRow}>
          <div className={styles.identity}>
            <p className={styles.eyebrow}>Jullie gedeelde auto</p>
            <h1>{name}</h1>
          </div>

          {licensePlate ? (
            <span className={styles.plate}>{licensePlate}</span>
          ) : null}
        </div>

        <div className={styles.bottom}>
          <div className={styles.meta}>
            <span>
              <AppIcon name="users" size={17} />
              {memberCount} {memberCount === 1 ? "groepslid" : "groepsleden"}
            </span>

            <span>
              <AppIcon name="car" size={17} />
              {numbers.format(tripCount)} {tripCount === 1 ? "rit" : "ritten"}
            </span>
          </div>

          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
