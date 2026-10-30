"use client";

import { useEffect, useState, type MouseEvent } from "react";
import AppIcon, { type IconName } from "./app-icon";
import GlassSurface from "./glass-surface";
import styles from "./car-navigation.module.css";

const items: {
  id: string;
  label: string;
  icon: IconName;
}[] = [
  { id: "car-overview", label: "Overzicht", icon: "car" },
  { id: "car-planning", label: "Planning", icon: "calendar" },
  { id: "car-costs", label: "Kosten", icon: "wallet" },
  { id: "car-group", label: "Groep", icon: "users" },
];

export default function CarNavigation() {
  const [active, setActive] = useState(items[0].id);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);

    let frame = 0;

    function update() {
      frame = 0;

      if (document.body.style.position === "fixed") return;

      const threshold = window.innerHeight * 0.28;
      let current = sections[0]?.id ?? items[0].id;

      for (const section of sections) {
        if (section.getBoundingClientRect().top <= threshold) {
          current = section.id;
        }
      }

      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;

      if (atBottom && sections.length > 0) {
        current = sections[sections.length - 1].id;
      }

      setActive((previous) => (previous === current ? previous : current));
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function navigate(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const section = document.getElementById(id);

    if (!section) return;

    event.preventDefault();
    setActive(id);
    section.focus({ preventScroll: true });
    section.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <nav className={styles.dock} aria-label="Navigatie binnen deze auto">
      <GlassSurface className={styles.bar}>
        {items.map((item) => (
          <a
            key={item.id}
            href={"#" + item.id}
            className={styles.link}
            aria-current={active === item.id ? "location" : undefined}
            onClick={(event) => navigate(event, item.id)}
          >
            <AppIcon name={item.icon} size={21} />
            <span>{item.label}</span>
          </a>
        ))}
      </GlassSurface>
    </nav>
  );
}
