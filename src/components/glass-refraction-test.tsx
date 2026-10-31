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

export default function GlassRefractionTest({ photoSource, backHref }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<SVGImageElement>(null);
  const viewportRef = useRef<SVGSVGElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const [size, setSize] = useState({
    width: 1,
    height: 1,
  });
  const [imageReady, setImageReady] = useState(false);
  const [svgReady, setSvgReady] = useState(false);
  const [mode, setMode] = useState<"lens" | "red" | "off">("lens");

  const baseId = "glass-svg-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const id = baseId + "-" + Number(svgReady);

  useEffect(() => {
    const scene = sceneRef.current;
    const card = cardRef.current;
    const copy = copyRef.current;
    const viewport = viewportRef.current;
    const original = scene?.querySelector("img");
    const scrollRoot = document.scrollingElement;
    const Timeline = (window as NativeScrollWindow).ScrollTimeline;

    if (
      !scene ||
      !card ||
      !copy ||
      !viewport ||
      !original ||
      !scrollRoot ||
      !imageReady
    ) {
      return;
    }

    if (!Timeline) {
      if (statusRef.current) {
        statusRef.current.textContent =
          "Deze browser ondersteunt de scrolltijdlijn niet.";
      }

      return;
    }

    const timeline = new Timeline({
      source: scrollRoot,
      axis: "block",
    });

    let effect: KeyframeEffect | null = null;
    let animation: Animation | null = null;
    let frame = 0;
    let previousSize = "";

    function measure() {
      frame = 0;

      const photo = original!.getBoundingClientRect();
      const rect = viewport!.getBoundingClientRect();

      const width = rect.width;
      const height = rect.height;
      const naturalWidth = original!.naturalWidth;
      const naturalHeight = original!.naturalHeight;

      if (!naturalWidth || !naturalHeight) return;
      if (width <= 0 || height <= 0) return;

      const sizeKey = width + ":" + height;

      if (sizeKey !== previousSize) {
        previousSize = sizeKey;
        setSize({ width, height });
      }

      // De originele foto gebruikt object-fit: cover
      // met object-position: center.
      const coverScale = Math.max(
        photo.width / naturalWidth,
        photo.height / naturalHeight,
      );

      const renderedWidth = naturalWidth * coverScale;
      const renderedHeight = naturalHeight * coverScale;

      const x = photo.left - rect.left + (photo.width - renderedWidth) / 2;

      const y =
        photo.top -
        rect.top +
        (photo.height - renderedHeight) / 2 -
        scrollRoot!.scrollTop;

      const maxScroll = Math.max(
        0,
        scrollRoot!.scrollHeight - scrollRoot!.clientHeight,
      );

      // Gebruik echte SVG-pixels, zonder tweede cover-berekening.
      copy!.setAttribute("width", String(renderedWidth));
      copy!.setAttribute("height", String(renderedHeight));
      copy!.setAttribute("x", String(x));
      copy!.setAttribute("y", String(y));

      const keyframes: Keyframe[] = [
        {
          transform: "translateY(0px)",
        },
        {
          transform: "translateY(" + maxScroll + "px)",
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
  }, [photoSource, imageReady, svgReady]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={backHref}>← Terug naar de auto</Link>

        <button
          type="button"
          aria-label="Wissel tussen vervorming, rode filtertest en geen filter"
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
        <h1>SVG-glastest</h1>

        <p ref={statusRef}>
          Controleer eerst de uitlijning met de lens uit. Test daarna rood en de
          vervorming.
        </p>
      </div>

      <div
        ref={cardRef}
        className={styles.card}
        data-ready={imageReady && size.width > 1 ? "true" : undefined}
      >
        <div className={styles.clip} aria-hidden="true">
          <svg
            ref={viewportRef}
            xmlns="http://www.w3.org/2000/svg"
            width="100%"
            height="100%"
            style={{
              position: "absolute",
              inset: 0,
              display: "block",
              overflow: "hidden",
            }}
          >
            <defs>
              <filter
                id={id + "-lens"}
                x="0"
                y="0"
                width={size.width}
                height={size.height}
                filterUnits="userSpaceOnUse"
                primitiveUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.014 0.02"
                  numOctaves="1"
                  seed="5"
                  result="noise"
                />

                <feGaussianBlur
                  in="noise"
                  stdDeviation="2"
                  result="smoothNoise"
                />

                <feDisplacementMap
                  in="SourceGraphic"
                  in2="smoothNoise"
                  scale="32"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>

              <filter
                id={id + "-red"}
                x="0"
                y="0"
                width={size.width}
                height={size.height}
                filterUnits="userSpaceOnUse"
                primitiveUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
              >
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
              </filter>
            </defs>

            <g
              filter={
                mode === "off" ? undefined : "url(#" + id + "-" + mode + ")"
              }
            >
              <rect
                x="0"
                y="0"
                width={size.width}
                height={size.height}
                fill="var(--bg)"
              />

              <image
                ref={copyRef}
                href={photoSource}
                xlinkHref={photoSource}
                onLoad={() => setSvgReady(true)}
                preserveAspectRatio="none"
                style={{
                  transformOrigin: "0 0",
                  transformBox: "view-box",
                }}
              />
            </g>
          </svg>
        </div>

        <div className={styles.tint} aria-hidden="true" />

        <div className={styles.content}>
          <span className={styles.label}>Geregistreerde stand</span>

          <strong>100.216 km</strong>

          <span className={styles.description}>
            Vervorming over het volledige glasvlak.
          </span>
        </div>
      </div>

      <p className={styles.end}>Scroll ook langzaam terug omhoog.</p>
    </main>
  );
}
