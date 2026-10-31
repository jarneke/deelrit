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

type Material = {
  element: HTMLElement;
  borderLeft: number;
  borderTop: number;
  radius: string;
  visible: boolean;
};

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

    const scope = container;

    const reducedTransparency = window.matchMedia(
      "(prefers-reduced-transparency: reduce)",
    );

    const materials = new Map<HTMLElement, Material>();
    const activeMaterials = new Set<Material>();

    let image: HTMLImageElement | null = null;
    let frame = 0;
    let materialsDirty = true;
    let forceUpdate = true;
    let lastSignature = "";

    function disable(element: HTMLElement) {
      if (element.hasAttribute("data-glass-photo")) {
        element.removeAttribute("data-glass-photo");
      }
    }

    function clear(element: HTMLElement) {
      disable(element);

      for (const property of sceneProperties) {
        element.style.removeProperty(property);
      }
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const material = materials.get(entry.target as HTMLElement);
          if (!material) continue;

          material.visible = entry.isIntersecting;

          if (entry.isIntersecting) {
            activeMaterials.add(material);
          } else {
            activeMaterials.delete(material);
            disable(material.element);
          }
        }

        forceUpdate = true;
        schedule();
      },
      {
        rootMargin: "100px 0px",
        threshold: 0,
      },
    );

    function refreshMaterials() {
      materialsDirty = false;

      const elements = new Set(
        scope.querySelectorAll<HTMLElement>(materialSelector),
      );

      for (const [element, material] of materials) {
        if (!elements.has(element)) {
          intersectionObserver.unobserve(element);
          activeMaterials.delete(material);
          materials.delete(element);
          clear(element);
        }
      }

      // Lees vaste stijlen alleen wanneer de layout of inhoud verandert.
      const measurements = Array.from(elements, (element) => {
        const computed = window.getComputedStyle(element);

        return {
          element,
          borderLeft: Number.parseFloat(computed.borderLeftWidth) || 0,
          borderTop: Number.parseFloat(computed.borderTopWidth) || 0,
          radius: computed.borderRadius,
        };
      });

      for (const measurement of measurements) {
        const existing = materials.get(measurement.element);

        if (existing) {
          existing.borderLeft = measurement.borderLeft;
          existing.borderTop = measurement.borderTop;
          existing.radius = measurement.radius;
          continue;
        }

        const material: Material = {
          ...measurement,
          visible: false,
        };

        materials.set(material.element, material);
        intersectionObserver.observe(material.element);
      }
    }

    function update() {
      if (materialsDirty) {
        refreshMaterials();
        forceUpdate = true;
      }

      if (
        reducedTransparency.matches ||
        scope.getAttribute("data-photo-ready") !== "true" ||
        !image ||
        !image.complete ||
        !image.naturalWidth
      ) {
        for (const material of activeMaterials) {
          disable(material.element);
        }

        lastSignature = "";
        return;
      }

      const photo = image.getBoundingClientRect();
      const source = image.currentSrc || image.src;

      if (!source || photo.width <= 1 || photo.height <= 1) {
        for (const material of activeMaterials) {
          disable(material.element);
        }

        lastSignature = "";
        return;
      }

      const signature = [
        window.scrollX,
        window.scrollY,
        window.innerWidth,
        window.innerHeight,
        photo.left,
        photo.top,
        photo.width,
        photo.height,
        source,
      ].join("|");

      if (!forceUpdate && signature === lastSignature) {
        return;
      }

      forceUpdate = false;
      lastSignature = signature;

      const sourceValue = `url(${JSON.stringify(source)})`;
      const widthValue = `${photo.width}px`;
      const heightValue = `${photo.height}px`;

      // Eerst alle posities lezen, daarna pas styles schrijven.
      const measurements = Array.from(activeMaterials, (material) => {
        const rect = material.element.getBoundingClientRect();

        const overlaps =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > photo.top &&
          rect.top < photo.bottom &&
          rect.right > photo.left &&
          rect.left < photo.right;

        if (!overlaps) {
          return { material, values: null };
        }

        const x = photo.left - rect.left - material.borderLeft;
        const y = photo.top - rect.top - material.borderTop;

        return {
          material,
          values: {
            "--glass-photo-image": sourceValue,
            "--glass-photo-x": `${x}px`,
            "--glass-photo-y": `${y}px`,
            "--glass-photo-width": widthValue,
            "--glass-photo-height": heightValue,
            "--glass-photo-fade-start": `${y + photo.height * 0.35}px`,
            "--glass-photo-fade-middle": `${y + photo.height * 0.55}px`,
            "--glass-photo-fade-end": `${y + photo.height * 0.78}px`,
            "--glass-photo-bottom": `${y + photo.height}px`,
            "--glass-photo-radius": material.radius,
          },
        };
      });

      for (const { material, values } of measurements) {
        const element = material.element;

        if (!values) {
          disable(element);
          continue;
        }

        for (const [property, value] of Object.entries(values)) {
          setProperty(element, property, value);
        }

        if (!element.hasAttribute("data-glass-photo")) {
          element.setAttribute("data-glass-photo", "");
        }
      }
    }

    function schedule() {
      if (frame) return;

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    }

    function updateImmediately() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }

      update();
    }

    function refreshLayout() {
      materialsDirty = true;
      forceUpdate = true;
      schedule();
    }

    const geometryObserver = new MutationObserver(() => {
      // De achtergrondfoto is net verplaatst of vergroot.
      // Werk meteen bij, zonder een extra animation frame te wachten.
      updateImmediately();
    });

    const resizeObserver = new ResizeObserver(refreshLayout);

    function findImage() {
      const next = scope.querySelector<HTMLImageElement>(
        ':scope > div[aria-hidden="true"] > img',
      );

      if (next === image) return;

      image?.removeEventListener("load", refreshLayout);
      geometryObserver.disconnect();

      if (image) {
        resizeObserver.unobserve(image);
      }

      image = next;
      forceUpdate = true;
      lastSignature = "";

      if (!image) return;

      image.addEventListener("load", refreshLayout);
      resizeObserver.observe(image);

      if (image.parentElement) {
        geometryObserver.observe(image.parentElement, {
          attributes: true,
          attributeFilter: ["style"],
        });
      }
    }

    const contentObserver = new MutationObserver(() => {
      materialsDirty = true;
      forceUpdate = true;
      findImage();
      schedule();
    });

    contentObserver.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-photo-ready"],
    });

    resizeObserver.observe(scope);

    findImage();
    schedule();

    // Geen extra requestAnimationFrame tussen scroll en glasupdate.
    window.addEventListener("scroll", updateImmediately, {
      passive: true,
    });
    window.addEventListener("resize", refreshLayout);

    window.visualViewport?.addEventListener("resize", refreshLayout);
    window.visualViewport?.addEventListener("scroll", updateImmediately);

    reducedTransparency.addEventListener("change", refreshLayout);

    scope.addEventListener("animationend", refreshLayout, true);
    scope.addEventListener("transitionend", refreshLayout, true);
    scope.addEventListener("toggle", refreshLayout, true);

    return () => {
      window.cancelAnimationFrame(frame);

      contentObserver.disconnect();
      geometryObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      image?.removeEventListener("load", refreshLayout);

      window.removeEventListener("scroll", updateImmediately);
      window.removeEventListener("resize", refreshLayout);

      window.visualViewport?.removeEventListener("resize", refreshLayout);
      window.visualViewport?.removeEventListener("scroll", updateImmediately);

      reducedTransparency.removeEventListener("change", refreshLayout);

      scope.removeEventListener("animationend", refreshLayout, true);
      scope.removeEventListener("transitionend", refreshLayout, true);
      scope.removeEventListener("toggle", refreshLayout, true);

      for (const element of materials.keys()) {
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
