"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./glass-refraction-test.module.css";

type Props = {
  photoSource: string;
  backHref: string;
};

type Mode = "lens" | "red" | "off";

const VERTEX = [
  "attribute vec2 a_position;",
  "varying vec2 v_uv;",
  "void main() {",
  "  v_uv = a_position * 0.5 + 0.5;",
  "  gl_Position = vec4(a_position, 0.0, 1.0);",
  "}",
].join("\n");

const FRAGMENT = [
  "precision highp float;",
  "uniform sampler2D u_photo;",
  "uniform vec2 u_resolution;",
  "uniform vec2 u_image;",
  "uniform vec4 u_card;",
  "uniform int u_mode;",
  "varying vec2 v_uv;",

  "float roundedBox(vec2 p, vec2 halfSize, float r) {",
  "  vec2 q = abs(p) - halfSize + vec2(r);",
  "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;",
  "}",

  "void main() {",
  "  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;",
  "  vec2 local = p - u_card.xy;",
  "  float radius = min(26.0, min(u_card.z, u_card.w) * 0.5);",
  "  float distance = roundedBox(local - u_card.zw * 0.5, u_card.zw * 0.5, radius);",
  "  float mask = 1.0 - smoothstep(-0.8, 0.8, distance);",
  "  vec2 offset = vec2(0.0);",

  "  if (u_mode == 1) {",
  "    offset = vec2(",
  "      sin(local.y * 0.055 + sin(local.x * 0.025) * 1.2),",
  "      cos(local.x * 0.045 + sin(local.y * 0.03) * 1.3)",
  "    ) * 13.0 * mask;",
  "  }",

  "  float cover = max(u_resolution.x / u_image.x, u_resolution.y / u_image.y);",
  "  vec2 rendered = u_image * cover;",
  "  vec2 origin = (u_resolution - rendered) * 0.5;",
  "  vec2 uv = clamp((p + offset - origin) / rendered, 0.0, 1.0);",
  "  vec4 color = texture2D(u_photo, vec2(uv.x, 1.0 - uv.y));",

  "  if (u_mode == 2) {",
  "    color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), mask);",
  "  }",

  "  gl_FragColor = vec4(color.rgb, 1.0);",
  "}",
].join("\n");

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("De shader kon niet worden aangemaakt.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);

    throw new Error(message || "De shader kon niet worden gecompileerd.");
  }

  return shader;
}

function createRenderer(gl: WebGLRenderingContext) {
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;

  function dispose() {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }

  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);

    program = gl.createProgram();

    if (!program) {
      throw new Error("Het tekenprogramma kon niet worden gemaakt.");
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        gl.getProgramInfoLog(program) || "Het koppelen is mislukt.",
      );
    }

    buffer = gl.createBuffer();
    texture = gl.createTexture();

    if (!buffer || !texture) {
      throw new Error("Het grafische geheugen is niet beschikbaar.");
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "a_position");

    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "u_resolution");

    const imageSize = gl.getUniformLocation(program, "u_image");

    const card = gl.getUniformLocation(program, "u_card");

    const mode = gl.getUniformLocation(program, "u_mode");

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.uniform1i(gl.getUniformLocation(program, "u_photo"), 0);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let naturalWidth = 1;
    let naturalHeight = 1;

    return {
      upload(image: HTMLImageElement) {
        naturalWidth = image.naturalWidth;
        naturalHeight = image.naturalHeight;

        const limit = Math.min(
          2048,
          Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        );

        const factor = Math.min(1, limit / naturalWidth, limit / naturalHeight);

        const source = document.createElement("canvas");

        source.width = Math.max(1, Math.round(naturalWidth * factor));

        source.height = Math.max(1, Math.round(naturalHeight * factor));

        const context = source.getContext("2d");

        if (!context) {
          throw new Error("De foto kon niet worden voorbereid.");
        }

        context.drawImage(image, 0, 0, source.width, source.height);

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        );

        const error = gl.getError();

        if (error !== gl.NO_ERROR) {
          throw new Error(
            "De foto kon niet worden geladen in de renderer (" + error + ").",
          );
        }
      },

      draw(
        width: number,
        height: number,
        x: number,
        y: number,
        cardWidth: number,
        cardHeight: number,
        selectedMode: Mode,
      ) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

        gl.uniform2f(resolution, width, height);
        gl.uniform2f(imageSize, naturalWidth, naturalHeight);

        gl.uniform4f(card, x, y, cardWidth, cardHeight);

        gl.uniform1i(
          mode,
          selectedMode === "lens" ? 1 : selectedMode === "red" ? 2 : 0,
        );

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },

      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export default function GlassRefractionTest({ photoSource, backHref }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<Mode>("lens");

  const [mode, setMode] = useState<Mode>("lens");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const scene = sceneRef.current;
    const card = cardRef.current;
    const canvas = canvasRef.current;

    if (!scene || !card || !canvas) return;

    let disposed = false;
    let stopped = false;
    let frame = 0;

    let renderer: ReturnType<typeof createRenderer> | null = null;

    function report(message: string) {
      stopped = true;
      window.cancelAnimationFrame(frame);

      queueMicrotask(() => {
        if (!disposed) setError(message);
      });
    }

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      report("WebGL is niet beschikbaar in deze browser.");

      return () => {
        disposed = true;
      };
    }

    const image = new window.Image();

    function draw() {
      if (disposed || stopped || !renderer) return;

      const photo = scene!.getBoundingClientRect();
      const lens = card!.getBoundingClientRect();

      const density = Math.min(window.devicePixelRatio || 1, 1.5);

      const width = Math.max(1, Math.round(photo.width * density));

      const height = Math.max(1, Math.round(photo.height * density));

      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
      }

      renderer.draw(
        photo.width,
        photo.height,
        lens.left - photo.left,
        lens.top - photo.top,
        lens.width,
        lens.height,
        modeRef.current,
      );

      frame = window.requestAnimationFrame(draw);
    }

    function contextLost(event: Event) {
      event.preventDefault();

      report("De grafische context is onderbroken. Herlaad de testpagina.");
    }

    canvas.addEventListener("webglcontextlost", contextLost);

    try {
      renderer = createRenderer(gl);

      image.onload = () => {
        if (disposed || stopped || !renderer) return;

        try {
          renderer.upload(image);
          setReady(true);
          draw();
        } catch (loadError) {
          report(
            loadError instanceof Error
              ? loadError.message
              : "De foto kon niet laden.",
          );
        }
      };

      image.onerror = () => report("De autofoto kon niet worden geladen.");

      image.src = photoSource;
    } catch (initializationError) {
      report(
        initializationError instanceof Error
          ? initializationError.message
          : "De renderer kon niet worden gestart.",
      );
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);

      image.onload = null;
      image.onerror = null;

      canvas.removeEventListener("webglcontextlost", contextLost);

      renderer?.dispose();
    };
  }, [photoSource]);

  function changeMode() {
    const next =
      modeRef.current === "lens"
        ? "red"
        : modeRef.current === "red"
          ? "off"
          : "lens";

    modeRef.current = next;
    setMode(next);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={backHref}>← Terug naar de auto</Link>

        <button
          type="button"
          aria-label="Wissel tussen vervorming, rode test en geen vervorming"
          onClick={changeMode}
        >
          {mode === "lens"
            ? "Lens aan"
            : mode === "red"
              ? "Test rood"
              : "Lens uit"}
        </button>
      </header>

      <div ref={sceneRef} className={styles.scene} aria-hidden="true">
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />
      </div>

      <div className={styles.intro}>
        <h1>Glasproef — één beeld</h1>

        <p role={error ? "alert" : undefined}>
          {error ||
            (ready
              ? "Vergelijk lens aan en uit. De foto en vervorming worden samen getekend."
              : "Autofoto laden…")}
        </p>
      </div>

      <div ref={cardRef} className={styles.card}>
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
