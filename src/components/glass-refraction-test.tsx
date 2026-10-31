"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./glass-refraction-test.module.css";

type Props = {
  photoSource: string;
  backHref: string;
};

type NativeScrollWindow = Window & {
  ScrollTimeline?: new (options: {
    source: Element;
    axis: "block";
  }) => AnimationTimeline;
};

function roundedDistance(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const qx = Math.abs(x - width / 2) - (width / 2 - radius);
  const qy = Math.abs(y - height / 2) - (height / 2 - radius);

  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

function makeLensMap(width: number, height: number) {
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, 512 / width);

  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));

  const context = canvas.getContext("2d");
  if (!context) return "";

  const pixels = context.createImageData(canvas.width, canvas.height);

  const radius = Math.min(26, width / 2, height / 2);
  const depth = Math.min(26, height / 3);
  const scale = 36;

  for (let py = 0; py < canvas.height; py += 1) {
    for (let px = 0; px < canvas.width; px += 1) {
      const x = ((px + 0.5) / canvas.width) * width;
      const y = ((py + 0.5) / canvas.height) * height;

      const distance = roundedDistance(x, y, width, height, radius);

      const inside = Math.max(0, -distance);
      const edge = Math.max(0, 1 - inside / depth);

      const dx =
        roundedDistance(x + 0.5, y, width, height, radius) -
        roundedDistance(x - 0.5, y, width, height, radius);

      const dy =
        roundedDistance(x, y + 0.5, width, height, radius) -
        roundedDistance(x, y - 0.5, width, height, radius);

      const length = Math.hypot(dx, dy) || 1;
      const bend = Math.sin((edge * Math.PI) / 2) * 14;
      const index = (py * canvas.width + px) * 4;

      pixels.data[index] = Math.round(
        255 * (0.5 - ((dx / length) * bend) / scale),
      );

      pixels.data[index + 1] = Math.round(
        255 * (0.5 - ((dy / length) * bend) / scale),
      );

      pixels.data[index + 2] = 128;
      pixels.data[index + 3] = 255;
    }
  }

  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

export default function GlassRefractionTest({ photoSource, backHref }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const [map, setMap] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [mode, setMode] = useState<"lens" | "red" | "off">("lens");
  const [mapSize, setMapSize] = useState({
    width: 1,
    height: 1,
  });
  const [mapReady, setMapReady] = useState(false);

  const id = "glass-test-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const lensId =
    id + "-" + mapSize.width + "-" + mapSize.height + "-" + Number(mapReady);

  useEffect(() => {
    const scene = sceneRef.current;
    const card = cardRef.current;
    const copy = copyRef.current;
    const scrollRoot = document.scrollingElement;
    const Timeline = (window as NativeScrollWindow).ScrollTimeline;

    if (!scene || !card || !copy || !scrollRoot) return;

    if (!Timeline) {
      if (statusRef.current) {
        statusRef.current.textContent =
          "Deze browser ondersteunt de scrolltijdlijn van deze test niet.";
      }

      return;
    }

    const timeline = new Timeline({
      source: scrollRoot,
      axis: "block",
    });

    let animation: Animation | null = null;
    let effect: KeyframeEffect | null = null;
    let frame = 0;
    let lastSize = "";

    function measure() {
      frame = 0;

      const photo = scene!.getBoundingClientRect();
      const rect = card!.getBoundingClientRect();
      const width = card!.clientWidth;
      const height = card!.clientHeight;
      const size = width + ":" + height;

      if (width <= 0 || height <= 0) return;

      if (size !== lastSize) {
        lastSize = size;
        setMapReady(false);
        setMapSize({ width, height });
        setMap(makeLensMap(width, height));
      }

      const x = photo.left - rect.left - card!.clientLeft;

      const y = photo.top - rect.top - card!.clientTop - scrollRoot!.scrollTop;

      const maxScroll = Math.max(
        0,
        scrollRoot!.scrollHeight - scrollRoot!.clientHeight,
      );

      copy!.style.width = photo.width + "px";
      copy!.style.height = photo.height + "px";

      const keyframes: Keyframe[] = [
        {
          transform: "translate3d(" + x + "px," + y + "px,0)",
        },
        {
          transform: "translate3d(" + x + "px," + (y + maxScroll) + "px,0)",
        },
      ];

      if (effect) {
        effect.setKeyframes(keyframes);
      } else {
        effect = new KeyframeEffect(copy!, keyframes, {
          duration: "auto",
          easing: "linear",
          fill: "both",
        });

        animation = new Animation(effect, timeline);
        animation.play();
      }
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(measure);
      }
    }

    const observer = new ResizeObserver(schedule);

    observer.observe(scene);
    observer.observe(card);
    observer.observe(document.documentElement);

    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);

    schedule();

    return () => {
      window.cancelAnimationFrame(frame);
      animation?.cancel();
      observer.disconnect();

      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [photoSource]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={backHref}>← Terug naar de auto</Link>

        <button
          type="button"
          aria-label="Wissel tussen glas, rode filtertest en geen filter"
          onClick={() =>
            setMode((previous) =>
              previous === "lens" ? "red" : previous === "red" ? "off" : "lens",
            )
          }
        >
          {mode === "lens"
            ? "Lens aan"
            : mode === "red"
              ? "Filtertest rood"
              : "Lens uit"}
        </button>
      </header>

      <div ref={sceneRef} className={styles.scene} aria-hidden="true">
        <Image
          src={photoSource}
          alt=""
          fill
          unoptimized
          loading="eager"
          sizes="100vw"
          className={styles.photo}
          onLoad={() => setImageReady(true)}
        />
      </div>

      <div className={styles.intro}>
        <h1>Eén glaslens</h1>

        <p ref={statusRef}>
          Scroll de kaart over de auto en de bergen. Vergelijk met de lens uit.
        </p>
      </div>

      <svg
        className={styles.definitions}
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter
            id={lensId}
            x="0"
            y="0"
            width="100%"
            height="100%"
            filterUnits="objectBoundingBox"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodColor="rgb(128,128,128)" result="neutralMap" />

            <feImage
              href={map || undefined}
              xlinkHref={map || undefined}
              onLoad={() => setMapReady(true)}
              x="0"
              y="0"
              width={mapSize.width}
              height={mapSize.height}
              preserveAspectRatio="none"
              result="rawMap"
            />

            <feComposite
              in="rawMap"
              in2="neutralMap"
              operator="over"
              result="lensMap"
            />

            <feDisplacementMap
              in="SourceGraphic"
              in2="lensMap"
              scale="36"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          <filter id={id + "-red"} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      <div
        ref={cardRef}
        className={styles.card}
        data-ready={imageReady && !!map ? "true" : undefined}
      >
        <div className={styles.clip} aria-hidden="true">
          <div
            className={styles.optics}
            style={{
              filter:
                mode === "off" || !map
                  ? "none"
                  : 'url("#' + (mode === "red" ? id + "-red" : lensId) + '")',
            }}
          >
            <div
              ref={copyRef}
              className={styles.copy}
              style={{
                backgroundImage: "url(" + JSON.stringify(photoSource) + ")",
              }}
            />
          </div>
        </div>

        <div className={styles.tint} aria-hidden="true" />

        <div className={styles.content}>
          <span className={styles.label}>Geregistreerde stand</span>

          <strong>100.216 km</strong>

          <span className={styles.description}>
            De foto hoort door de randen van het glas te buigen.
          </span>
        </div>
      </div>

      <p className={styles.end}>Scroll ook langzaam terug omhoog.</p>
    </main>
  );
}
