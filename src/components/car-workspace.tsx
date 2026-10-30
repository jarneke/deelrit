"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import AppIcon, { type IconName } from "./app-icon";
import GlassSurface, { GlassScope } from "./glass-surface";
import styles from "./car-workspace.module.css";

const links: {
  id: string;
  label: string;
  icon: IconName;
}[] = [
  { id: "car-overview", label: "Overzicht", icon: "car" },
  { id: "car-history", label: "Historiek", icon: "wallet" },
  { id: "car-costs", label: "Kosten", icon: "gauge" },
  { id: "car-planning", label: "Planning", icon: "calendar" },
  { id: "car-group", label: "Groep", icon: "users" },
];

type Props = {
  photoSource: string;
  hero: ReactNode;
  startpoint: ReactNode;
  trips: ReactNode;
  refuels: ReactNode;
  recent: ReactNode;
  planning: ReactNode;
  costs: ReactNode;
  group: ReactNode;
  statisticsHref: string;
};

export default function CarWorkspace({
  photoSource,
  hero,
  startpoint,
  trips,
  refuels,
  recent,
  planning,
  costs,
  group,
  statisticsHref,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const imageRatio = useRef<number | null>(null);

  const [active, setActive] = useState("car-overview");
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);

  const reveal = useCallback((id: string, push = true) => {
    const container = root.current;
    if (!container) return;

    let target: HTMLElement | null = null;

    if (id === "car-trip-history" || id === "car-refuel-history") {
      const slot = container.querySelector(
        id === "car-trip-history"
          ? '[data-entry="trip"]'
          : '[data-entry="refuel"]',
      );

      const history = slot?.querySelector<HTMLDetailsElement>(
        ":scope > section > details",
      );

      if (history) {
        history.id = id;
        history.open = true;
        target = history;
      }
    } else {
      target = document.getElementById(id);

      if (target instanceof HTMLDetailsElement) {
        target.open = true;
      }
    }

    if (!target) return;

    if (push) {
      window.history.pushState(null, "", "#" + id);
    }

    const destination = target;

    window.requestAnimationFrame(() => {
      const focusTarget =
        destination instanceof HTMLDetailsElement
          ? destination.querySelector<HTMLElement>("summary")
          : destination;

      focusTarget?.focus({ preventScroll: true });

      destination.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  }, []);

  useEffect(() => {
    let frame = 0;

    let origin: {
      top: number;
      left: number;
      width: number;
      height: number;
    } | null = null;

    function update() {
      frame = 0;

      if (document.body.style.position === "fixed") return;

      const progress = Math.min(1, Math.max(0, window.scrollY / 220));

      root.current?.style.setProperty(
        "--hero-surface-strength",
        `${(1 - progress) * 100}%`,
      );

      const heroElement = heroRef.current;
      const layer = backdrop.current;

      if (heroElement && layer) {
        const visual = heroElement.firstElementChild?.firstElementChild;

        if (!(visual instanceof HTMLElement)) return;

        if (imageRatio.current) {
          visual.style.height =
            visual.getBoundingClientRect().width / imageRatio.current + "px";
        }

        if (!origin) {
          const rect = visual.getBoundingClientRect();

          origin = {
            top: rect.top + window.scrollY,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          };
        }

        const header = root.current?.closest("main")?.querySelector("header");
        const headerBottom = header?.getBoundingClientRect().bottom ?? 80;

        const top = origin.top + (headerBottom - origin.top) * progress;
        const left = origin.left * (1 - progress);
        const width =
          origin.width + (window.innerWidth - origin.width) * progress;
        const ratio = imageRatio.current ?? origin.width / origin.height;
        const height = width / ratio;

        layer.style.top = top + "px";
        layer.style.left = left + "px";
        layer.style.width = width + "px";
        layer.style.height = Math.max(1, height) + "px";

        const radius = 24 * (1 - progress);
        const photoRadius = `${radius}px ${radius}px 0px 0px`;

        layer.style.borderRadius = photoRadius;
        visual.style.borderRadius = photoRadius;
        layer.style.opacity = "1";
      }

      let current = links[0].id;

      for (const link of links) {
        const element = document.getElementById(link.id);

        if (element && element.getBoundingClientRect().top <= 150) {
          current = link.id;
        }
      }

      setActive((previous) => (previous === current ? previous : current));
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    }

    function resize() {
      origin = null;
      schedule();
    }

    function restore() {
      const id = window.location.hash.slice(1);
      if (id) reveal(id, false);
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);

    restore();
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("popstate", restore);
      window.cancelAnimationFrame(frame);
    };
  }, [reveal]);

  function follow(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    reveal(id);
  }

  return (
    <GlassScope
      ref={root}
      className={styles.workspace}
      data-photo-ready={photoReady && !photoFailed ? "true" : undefined}
    >
      {!photoFailed && (
        <div ref={backdrop} className={styles.backdrop} aria-hidden="true">
          <Image
            loading="eager"
            src={photoSource}
            alt=""
            fill
            unoptimized
            sizes="100vw"
            className={styles.backgroundImage}
            onLoad={(event) => {
              const image = event.currentTarget;

              if (image.naturalWidth && image.naturalHeight) {
                imageRatio.current = image.naturalWidth / image.naturalHeight;
              }

              setPhotoReady(true);
              window.dispatchEvent(new Event("resize"));
            }}
            onError={() => setPhotoFailed(true)}
          />

          <div className={styles.wash} />
        </div>
      )}

      <section id="car-overview" className={styles.overview} tabIndex={-1}>
        <div ref={heroRef} className={styles.heroMount}>
          {hero}
        </div>

        {startpoint}
      </section>

      <section
        id="car-history"
        className={styles.history}
        tabIndex={-1}
        aria-label="Ritten, tankbeurten en laatste activiteit"
      >
        <div className={styles.entries}>
          <div data-entry="trip" className={styles.tripSlot}>
            {trips}
          </div>

          <div data-entry="refuel" className={styles.refuelSlot}>
            {refuels}
          </div>

          <section
            className={styles.recent}
            aria-label="Laatste activiteit"
            onClick={(event) => {
              if (!(event.target instanceof Element)) return;

              const anchor =
                event.target.closest<HTMLAnchorElement>('a[href^="#car-"]');

              if (
                !anchor ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }

              const id = anchor.getAttribute("href")?.slice(1);

              if (id === "car-trip-history" || id === "car-refuel-history") {
                event.preventDefault();
                reveal(id);
              }
            }}
          >
            {recent}
          </section>

          <section
            id="car-costs"
            className={styles.costs}
            aria-label="Afrekening"
          >
            {costs}
          </section>
        </div>
      </section>

      <Link data-glass className={styles.statistics} href={statisticsHref}>
        <AppIcon name="gauge" size={21} />

        <span>
          <strong>Statistieken</strong>
          <small>Kilometers, verbruik en kosten</small>
        </span>

        <AppIcon name="arrow-right" size={18} />
      </Link>

      <section
        id="car-planning"
        className={styles.section}
        tabIndex={-1}
        aria-label="Planning"
      >
        {planning}
      </section>

      <section
        id="car-group"
        className={styles.section}
        tabIndex={-1}
        aria-label="Groep en uitnodigingen"
      >
        {group}
      </section>

      <nav className={styles.dock} aria-label="Snel naar een onderdeel">
        <GlassSurface className={styles.bar}>
          {links.map((link) => (
            <a
              key={link.id}
              href={"#" + link.id}
              className={styles.link}
              aria-current={active === link.id ? "location" : undefined}
              onClick={(event) => follow(event, link.id)}
            >
              <AppIcon name={link.icon} size={20} />
              <span>{link.label}</span>
            </a>
          ))}
        </GlassSurface>
      </nav>
    </GlassScope>
  );
}
