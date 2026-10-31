"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
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

const sceneProperties = [
  "--glass-photo-image",
  "--glass-photo-x",
  "--glass-photo-y",
  "--glass-photo-width",
  "--glass-photo-height",
  "--glass-photo-fade-start",
  "--glass-photo-fade-middle",
  "--glass-photo-fade-end",
  "--glass-photo-bottom",
  "--glass-photo-radius",
] as const;

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

function setProperty(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

function usePhotoRefraction(root: { readonly current: HTMLDivElement | null }) {
  useEffect(() => {
    const container = root.current;

    if (!container || !window.CSS.supports("-webkit-touch-callout", "none")) {
      return;
    }

    const reducedTransparency = window.matchMedia(
      "(prefers-reduced-transparency: reduce)",
    );

    let frame = 0;
    let image: HTMLImageElement | null = null;
    let surfaces: HTMLElement[] = [];
    let dirty = true;

    const touched = new Set<HTMLElement>();

    function disable(element: HTMLElement) {
      element.removeAttribute("data-glass-photo");
    }

    function clear(element: HTMLElement) {
      disable(element);

      for (const property of sceneProperties) {
        element.style.removeProperty(property);
      }
    }

    function update() {
      frame = 0;

      if (dirty) {
        surfaces = Array.from(
          container!.querySelectorAll<HTMLElement>(materialSelector),
        );
        dirty = false;

        for (const element of touched) {
          if (!container!.contains(element)) {
            clear(element);
            touched.delete(element);
          }
        }
      }

      if (
        reducedTransparency.matches ||
        container!.getAttribute("data-photo-ready") !== "true" ||
        !image ||
        !image.complete ||
        !image.naturalWidth
      ) {
        for (const element of touched) {
          disable(element);
        }

        return;
      }

      const photo = image.getBoundingClientRect();
      const source = image.currentSrc || image.src;

      if (!source || photo.width <= 1 || photo.height <= 1) {
        for (const element of touched) {
          disable(element);
        }

        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const measurements = surfaces.map((element) => {
        const rect = element.getBoundingClientRect();

        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < viewportHeight &&
          rect.right > 0 &&
          rect.left < viewportWidth;

        const overlaps =
          visible &&
          rect.bottom > photo.top &&
          rect.top < photo.bottom &&
          rect.right > photo.left &&
          rect.left < photo.right;

        if (!overlaps) {
          return { element, values: null };
        }

        const computed = window.getComputedStyle(element);

        const left =
          rect.left + (Number.parseFloat(computed.borderLeftWidth) || 0);
        const top =
          rect.top + (Number.parseFloat(computed.borderTopWidth) || 0);

        const x = photo.left - left;
        const y = photo.top - top;

        return {
          element,
          values: {
            "--glass-photo-image": `url(${JSON.stringify(source)})`,
            "--glass-photo-x": `${x}px`,
            "--glass-photo-y": `${y}px`,
            "--glass-photo-width": `${photo.width}px`,
            "--glass-photo-height": `${photo.height}px`,
            "--glass-photo-fade-start": `${y + photo.height * 0.35}px`,
            "--glass-photo-fade-middle": `${y + photo.height * 0.55}px`,
            "--glass-photo-fade-end": `${y + photo.height * 0.78}px`,
            "--glass-photo-bottom": `${y + photo.height}px`,
            "--glass-photo-radius": computed.borderRadius,
          },
        };
      });

      for (const { element, values } of measurements) {
        if (!values) {
          disable(element);
          continue;
        }

        for (const [property, value] of Object.entries(values)) {
          setProperty(element, property, value);
        }

        touched.add(element);

        if (!element.hasAttribute("data-glass-photo")) {
          element.setAttribute("data-glass-photo", "");
        }
      }
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    }

    const geometryObserver = new MutationObserver(() => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }

      update();
    });

    const resizeObserver = new ResizeObserver(schedule);

    function findImage() {
      const next = container!.querySelector<HTMLImageElement>(
        ':scope > div[aria-hidden="true"] > img',
      );

      if (next === image) return;

      image?.removeEventListener("load", schedule);
      geometryObserver.disconnect();
      resizeObserver.disconnect();

      image = next;

      if (image) {
        image.addEventListener("load", schedule);
        resizeObserver.observe(image);

        if (image.parentElement) {
          resizeObserver.observe(image.parentElement);

          geometryObserver.observe(image.parentElement, {
            attributes: true,
            attributeFilter: ["style"],
          });
        }
      }
    }

    const contentObserver = new MutationObserver(() => {
      dirty = true;
      findImage();
      schedule();
    });

    contentObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-photo-ready"],
    });

    findImage();
    schedule();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    reducedTransparency.addEventListener("change", schedule);

    container.addEventListener("animationend", schedule, true);
    container.addEventListener("transitionend", schedule, true);
    container.addEventListener("toggle", schedule, true);

    return () => {
      window.cancelAnimationFrame(frame);

      contentObserver.disconnect();
      geometryObserver.disconnect();
      resizeObserver.disconnect();

      image?.removeEventListener("load", schedule);

      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      reducedTransparency.removeEventListener("change", schedule);

      container.removeEventListener("animationend", schedule, true);
      container.removeEventListener("transitionend", schedule, true);
      container.removeEventListener("toggle", schedule, true);

      for (const element of touched) {
        clear(element);
      }
    };
  }, [root]);
}

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
  const root = useRef<HTMLDivElement>(null);
  const { filterId, surfaceStyle } = useGlassStyle(style);

  useImperativeHandle(ref, () => root.current!, []);
  usePhotoRefraction(root);

  return (
    <div
      {...props}
      ref={root}
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
