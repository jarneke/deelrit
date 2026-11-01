"use client";

import {
  useImperativeHandle,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Ref,
} from "react";
import { useGlassRefraction } from "./glass-refraction";
import styles from "./glass-surface.module.css";

type Props = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article";
  tone?: "glass" | "solid";
};

type ScopeProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
};

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

const materialSelector = [
  "." + styles.surface + ":not(." + styles.solid + ")",
  "[data-glass]",
  "#car-costs > section",
  "#car-planning > section",
  "#car-group > section",
  '#car-history > div > section[aria-label="Laatste activiteit"] a',
  '[data-entry="refuel"] > section > div:first-child > button',
  "[data-entry] > section > details",
  "#car-overview > div:first-child > div > div:last-child > div:last-child > div:last-child button",
].join(",");

export function GlassScope({ ref, className, children, ...props }: ScopeProps) {
  const root = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => root.current!, []);
  useGlassRefraction(root, materialSelector);

  return (
    <div
      {...props}
      ref={root}
      className={[styles.scope, className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

export function GlassButton({
  className,
  children,
  type = "button",
  ...props
}: GlassButtonProps) {
  return (
    <button
      {...props}
      type={type}
      data-glass=""
      className={[styles.surface, className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export default function GlassSurface({
  as: Element = "div",
  tone = "glass",
  className,
  children,
  ...props
}: Props) {
  const classes = [styles.surface, tone === "solid" && styles.solid, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Element
      {...props}
      data-glass={tone === "glass" ? "" : undefined}
      className={classes}
    >
      {children}
    </Element>
  );
}
