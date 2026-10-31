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

type NativeScrollWindow = Window & {
  ScrollTimeline?: new (options: {
    source: Element;
    axis: "block";
  }) => AnimationTimeline;
};

type PhotoLayer = {
  clip: HTMLSpanElement;
  mover: HTMLSpanElement;
  texture: HTMLSpanElement;
  effect: KeyframeEffect | null;
  animation: Animation | null;
};

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

function isFixed(element: HTMLElement) {
  let current: HTMLElement | null = element;

  while (current) {
    if (window.getComputedStyle(current).position === "fixed") {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function usePhotoRefraction(root: { readonly current: HTMLDivElement | null }) {
  useEffect(() => {
    const scope = root.current;
    const Timeline = (window as NativeScrollWindow).ScrollTimeline;
    const scrollRoot = document.scrollingElement;

    if (
      !scope ||
      !Timeline ||
      !scrollRoot ||
      !window.CSS.supports("-webkit-touch-callout", "none")
    ) {
      return;
    }

    const container = scope;
    const timeline = new Timeline({
      source: scrollRoot,
      axis: "block",
    });

    const reducedTransparency = window.matchMedia(
      "(prefers-reduced-transparency: reduce)",
    );

    const layers = new Map<HTMLElement, PhotoLayer>();

    let image: HTMLImageElement | null = null;
    let frame = 0;
    let layoutDirty = true;
    let lastScene = "";

    function removeLayer(element: HTMLElement, layer: PhotoLayer) {
      layer.animation?.cancel();
      layer.clip.remove();
      element.removeAttribute("data-glass-native");
      layers.delete(element);
    }

    function clearLayers() {
      for (const [element, layer] of layers) {
        removeLayer(element, layer);
      }
    }

    function createLayer(element: HTMLElement): PhotoLayer {
      const clip = document.createElement("span");
      const mover = document.createElement("span");
      const texture = document.createElement("span");

      clip.className = styles.photoClip;
      mover.className = styles.photoMover;
      texture.className = styles.photoTexture;

      clip.setAttribute("data-glass-decoration", "");
      clip.setAttribute("aria-hidden", "true");

      // De filterlaag blijft vast aan het glasvlak.
      // Alleen de foto binnen die filterlaag beweegt.
      texture.append(mover);
      clip.append(texture);
      element.append(clip);
      element.setAttribute("data-glass-native", "");

      const layer: PhotoLayer = {
        clip,
        mover,
        texture,
        effect: null,
        animation: null,
      };

      layers.set(element, layer);
      return layer;
    }

    function update() {
      frame = 0;

      if (
        reducedTransparency.matches ||
        container.getAttribute("data-photo-ready") !== "true" ||
        !image ||
        !image.complete ||
        !image.naturalWidth
      ) {
        clearLayers();
        lastScene = "";
        return;
      }

      const photo = image.getBoundingClientRect();

      if (photo.width <= 1 || photo.height <= 1) {
        return;
      }

      const source = image.currentSrc || image.src;

      const maxScroll = Math.max(
        0,
        scrollRoot!.scrollHeight - scrollRoot!.clientHeight,
      );

      const scene = [
        source,
        photo.left,
        photo.top,
        photo.width,
        photo.height,
        maxScroll,
      ].join("|");

      if (!layoutDirty && scene === lastScene) {
        return;
      }

      layoutDirty = false;
      lastScene = scene;

      const elements = new Set(
        container.querySelectorAll<HTMLElement>(materialSelector),
      );

      for (const [element, layer] of layers) {
        if (!elements.has(element) || layer.clip.parentElement !== element) {
          removeLayer(element, layer);
        }
      }

      const scrollY = scrollRoot!.scrollTop;

      const measurements = Array.from(elements, (element) => {
        const rect = element.getBoundingClientRect();
        const computed = window.getComputedStyle(element);

        return {
          element,
          fixed: isFixed(element),
          x:
            photo.left -
            rect.left -
            (Number.parseFloat(computed.borderLeftWidth) || 0),
          y:
            photo.top -
            rect.top -
            (Number.parseFloat(computed.borderTopWidth) || 0),
        };
      });

      for (const { element, fixed, x, y } of measurements) {
        const layer = layers.get(element) ?? createLayer(element);

        layer.mover.style.width = photo.width + "px";
        layer.mover.style.height = photo.height + "px";
        layer.mover.style.backgroundSize = "100% 100%";
        layer.mover.style.backgroundRepeat = "no-repeat";

        layer.mover.style.backgroundImage =
          "linear-gradient(to bottom, transparent 35%, " +
          "color-mix(in srgb, var(--bg) 15%, transparent) 55%, " +
          "color-mix(in srgb, var(--bg) 65%, transparent) 78%, " +
          "var(--bg) 100%), url(" +
          JSON.stringify(source) +
          ")";

        if (fixed || maxScroll === 0) {
          layer.animation?.cancel();
          layer.animation = null;
          layer.effect = null;

          layer.mover.style.transform =
            "translate3d(" + x + "px," + y + "px,0)";

          continue;
        }

        const startY = y - scrollY;

        const keyframes: Keyframe[] = [
          {
            transform: "translate3d(" + x + "px," + startY + "px,0)",
          },
          {
            transform:
              "translate3d(" + x + "px," + (startY + maxScroll) + "px,0)",
          },
        ];

        if (layer.effect) {
          layer.effect.setKeyframes(keyframes);
        } else {
          layer.effect = new KeyframeEffect(layer.mover, keyframes, {
            duration: "auto",
            fill: "both",
            easing: "linear",
          });

          layer.animation = new Animation(layer.effect, timeline);
          layer.animation.play();
        }
      }
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    }

    function refreshLayout() {
      layoutDirty = true;
      schedule();
    }

    const geometryObserver = new MutationObserver(() => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      frame = 0;
      update();
    });

    function findImage() {
      const next = container.querySelector<HTMLImageElement>(
        ':scope > div[aria-hidden="true"] > img',
      );

      if (next === image) {
        return;
      }

      image?.removeEventListener("load", refreshLayout);
      geometryObserver.disconnect();
      image = next;

      image?.addEventListener("load", refreshLayout);

      if (image?.parentElement) {
        geometryObserver.observe(image.parentElement, {
          attributes: true,
          attributeFilter: ["style"],
        });
      }

      layoutDirty = true;
      lastScene = "";
    }

    function decorationMutation(record: MutationRecord) {
      if (record.type !== "childList") {
        return false;
      }

      if (
        record.target instanceof Element &&
        record.target.closest("[data-glass-decoration]")
      ) {
        return true;
      }

      const changed = [...record.addedNodes, ...record.removedNodes];

      return (
        changed.length > 0 &&
        changed.every(
          (node) =>
            node instanceof Element &&
            node.hasAttribute("data-glass-decoration"),
        )
      );
    }

    const contentObserver = new MutationObserver((records) => {
      if (records.every(decorationMutation)) {
        return;
      }

      findImage();
      refreshLayout();
    });

    contentObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-photo-ready", "open", "class"],
    });

    const resizeObserver = new ResizeObserver(refreshLayout);

    resizeObserver.observe(container);
    resizeObserver.observe(document.documentElement);

    findImage();
    schedule();

    window.addEventListener("resize", refreshLayout);

    window.visualViewport?.addEventListener("resize", refreshLayout);

    reducedTransparency.addEventListener("change", refreshLayout);

    container.addEventListener("animationend", refreshLayout, true);

    container.addEventListener("transitionend", refreshLayout, true);

    container.addEventListener("toggle", refreshLayout, true);

    return () => {
      window.cancelAnimationFrame(frame);

      contentObserver.disconnect();
      geometryObserver.disconnect();
      resizeObserver.disconnect();

      image?.removeEventListener("load", refreshLayout);

      window.removeEventListener("resize", refreshLayout);

      window.visualViewport?.removeEventListener("resize", refreshLayout);

      reducedTransparency.removeEventListener("change", refreshLayout);

      container.removeEventListener("animationend", refreshLayout, true);

      container.removeEventListener("transitionend", refreshLayout, true);

      container.removeEventListener("toggle", refreshLayout, true);

      clearLayers();
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
