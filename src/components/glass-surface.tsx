"use client";

import {
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
} from "react";
import styles from "./glass-surface.module.css";

type Props = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article";
  tone?: "glass" | "solid";
};

type ScopeProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
};

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

function GlassDefinitions({ id }: { id: string }) {
  return (
    <svg
      className={styles.definitions}
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter
          id={id}
          x="-15%"
          y="-15%"
          width="130%"
          height="130%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.01 0.01"
            numOctaves="1"
            seed="5"
            result="turbulence"
          />

          <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />

          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale="35"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

function useGlassStyle(style?: CSSProperties) {
  const id = useId();

  const filterId = "deelrit-glass-" + id.replace(/[^a-zA-Z0-9_-]/g, "");

  const surfaceStyle = {
    ...style,
    "--glass-filter": 'url("#' + filterId + '")',
  } as CSSProperties;

  return { filterId, surfaceStyle };
}

export function GlassScope({
  ref,
  className,
  style,
  children,
  ...props
}: ScopeProps) {
  const { filterId, surfaceStyle } = useGlassStyle(style);

  return (
    <div
      {...props}
      ref={ref}
      className={[styles.scope, className].filter(Boolean).join(" ")}
      style={surfaceStyle}
    >
      <GlassDefinitions id={filterId} />
      {children}
    </div>
  );
}

export function GlassButton({
  className,
  style,
  children,
  type = "button",
  ...props
}: GlassButtonProps) {
  const { filterId, surfaceStyle } = useGlassStyle(style);

  return (
    <>
      <GlassDefinitions id={filterId} />

      <button
        {...props}
        type={type}
        className={[styles.surface, className].filter(Boolean).join(" ")}
        style={surfaceStyle}
      >
        {children}
      </button>
    </>
  );
}

export default function GlassSurface({
  as: Element = "div",
  tone = "glass",
  className,
  children,
  style,
  ...props
}: Props) {
  const { filterId, surfaceStyle } = useGlassStyle(style);

  const classes = [styles.surface, tone === "solid" && styles.solid, className]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {tone === "glass" && <GlassDefinitions id={filterId} />}

      <Element {...props} className={classes} style={surfaceStyle}>
        {children}
      </Element>
    </>
  );
}
