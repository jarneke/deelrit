"use client";

import { useEffect } from "react";

const REFRACTION_STRENGTH = 6;

type Lens = {
    rect: [number, number, number, number];
    radii: [number, number, number, number];
};

const VERTEX = [
    "attribute vec2 a_position;",
    "varying vec2 v_uv;",
    "void main() {",
    "  v_uv = a_position * 0.5 + 0.5;",
    "  gl_Position = vec4(a_position, 0.0, 1.0);",
    "}",
].join("\n");

function fragmentSource(capacity: number) {
    return [
        "precision highp float;",
        "uniform sampler2D u_photo;",
        "uniform vec2 u_resolution;",
        "uniform vec4 u_imageRect;",
        "uniform vec4 u_rects[" + capacity + "];",
        "uniform vec4 u_radii[" + capacity + "];",
        "uniform int u_count;",
        "varying vec2 v_uv;",

        "float roundedBox(vec2 p, vec2 halfSize, float r) {",
        "  vec2 q = abs(p) - halfSize + vec2(r);",
        "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;",
        "}",

        "void main() {",
        "  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;",
        "  vec2 offset = vec2(0.0);",

        "  for (int i = 0; i < " + capacity + "; i++) {",
        "    if (i >= u_count) break;",
        "    vec4 box = u_rects[i];",
        "    vec2 local = p - box.xy;",
        "    if (local.x < -1.0 || local.y < -1.0 || local.x > box.z + 1.0 || local.y > box.w + 1.0) continue;",

        "    vec2 halfSize = box.zw * 0.5;",
        "    vec4 corners = u_radii[i];",
        "    float r = local.x < halfSize.x ? (local.y < halfSize.y ? corners.x : corners.w) : (local.y < halfSize.y ? corners.y : corners.z);",
        "    r = min(r, min(halfSize.x, halfSize.y));",
        "    float d = roundedBox(local - halfSize, halfSize, r);",
        "    float mask = 1.0 - smoothstep(-0.8, 0.8, d);",

        "    vec2 wave = vec2(",
        "      sin(local.y * 0.055 + sin(local.x * 0.025) * 1.2),",
        "      cos(local.x * 0.045 + sin(local.y * 0.03) * 1.3)",
        "    ) * " + REFRACTION_STRENGTH.toFixed(1) + ";",

        "    offset = mix(offset, wave, mask);",
        "  }",

        "  vec2 baseUV = (p - u_imageRect.xy) / u_imageRect.zw;",
        "  vec2 uv = clamp((p + offset - u_imageRect.xy) / u_imageRect.zw, 0.0, 1.0);",

        "  if (baseUV.x < 0.0 || baseUV.y < 0.0 || baseUV.x > 1.0 || baseUV.y > 1.0) {",
        "    gl_FragColor = vec4(0.0);",
        "  } else {",
        "    gl_FragColor = texture2D(u_photo, vec2(uv.x, 1.0 - uv.y));",
        "  }",
        "}",
    ].join("\n");
}

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

        throw new Error(
            message || "De shader kon niet worden gecompileerd.",
        );
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

    const capacity = Math.max(
        1,
        Math.min(
            32,
            Math.floor(
                (Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)) - 12) / 2,
            ),
        ),
    );

    try {
        vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
        fragment = compileShader(
            gl,
            gl.FRAGMENT_SHADER,
            fragmentSource(capacity),
        );

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
        const imageRect = gl.getUniformLocation(program, "u_imageRect");
        const rects = gl.getUniformLocation(program, "u_rects[0]");
        const radii = gl.getUniformLocation(program, "u_radii[0]");
        const count = gl.getUniformLocation(program, "u_count");

        const rectValues = new Float32Array(capacity * 4);
        const radiusValues = new Float32Array(capacity * 4);

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
            capacity,

            upload(image: HTMLImageElement) {
                naturalWidth = image.naturalWidth;
                naturalHeight = image.naturalHeight;

                const limit = Math.min(
                    2048,
                    Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
                );

                const factor = Math.min(
                    1,
                    limit / naturalWidth,
                    limit / naturalHeight,
                );

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
                        "De foto kon niet worden geladen in de renderer (" +
                        error +
                        ").",
                    );
                }
            },

            draw(
                width: number,
                height: number,
                image: [number, number, number, number],
                lenses: Lens[],
            ) {
                const visible = lenses.slice(0, capacity);

                visible.forEach((lens, index) => {
                    rectValues.set(lens.rect, index * 4);
                    radiusValues.set(lens.radii, index * 4);
                });

                gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
                gl.uniform2f(resolution, width, height);
                gl.uniform4f(imageRect, ...image);
                gl.uniform4fv(rects, rectValues);
                gl.uniform4fv(radii, radiusValues);
                gl.uniform1i(count, visible.length);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            },

            dispose,
        };
    } catch (error) {
        dispose();
        throw error;
    }
}

type Material = {
    element: HTMLElement;
    radii: [number, number, number, number];
};

type Photo = {
    image: HTMLImageElement;
    canvas: HTMLCanvasElement;
    renderer: ReturnType<typeof createRenderer> | null;
    source: string;
    failed: boolean;
    upload: () => boolean;
    dispose: () => void;
};

function radiusValue(
    value: string,
    width: number,
    height: number,
) {
    const number = Number.parseFloat(value) || 0;

    return value.includes("%")
        ? (Math.min(width, height) * number) / 100
        : number;
}

function positionOffset(value: string, available: number) {
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return available;

    if (value.endsWith("%")) {
        return (available * Number.parseFloat(value)) / 100;
    }

    if (value.endsWith("px")) {
        return Number.parseFloat(value);
    }

    return available / 2;
}

export function useGlassRefraction(
    root: { readonly current: HTMLDivElement | null },
    selector: string,
) {
    useEffect(() => {
        const scope = root.current;
        if (!scope) return;

        const photos = new Map<HTMLImageElement, Photo>();
        const materials = new Map<HTMLElement, Material>();
        const active = new Set<Material>();
        const marked = new Set<HTMLElement>();

        const reduced = window.matchMedia(
            "(prefers-reduced-transparency: reduce)",
        );

        let disposed = false;
        let dirty = true;
        let frame = 0;

        const intersections = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const material = materials.get(
                        entry.target as HTMLElement,
                    );

                    if (!material) continue;

                    if (entry.isIntersecting) {
                        active.add(material);
                    } else {
                        active.delete(material);
                    }
                }
            },
            { rootMargin: "100px" },
        );

        function createPhoto(image: HTMLImageElement): Photo {
            const canvas = document.createElement("canvas");

            canvas.className = image.className;
            canvas.setAttribute("data-glass-renderer", "");
            canvas.setAttribute("aria-hidden", "true");

            canvas.style.cssText =
                "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";

            image.parentElement?.append(canvas);

            const photo: Photo = {
                image,
                canvas,
                renderer: null,
                source: "",
                failed: false,
                upload: () => false,
                dispose: () => undefined,
            };

            function fail() {
                photo.failed = true;
                photo.source = "";

                canvas.style.display = "none";
                image.removeAttribute("data-glass-rendered");
            }

            function loaded() {
                photo.failed = false;
                photo.source = "";
            }

            function lost(event: Event) {
                event.preventDefault();
                fail();
            }

            function restored() {
                photo.renderer?.dispose();
                photo.renderer = null;
                loaded();
            }

            photo.upload = () => {
                if (
                    photo.failed ||
                    !image.complete ||
                    !image.naturalWidth
                ) {
                    return false;
                }

                const source = image.currentSrc || image.src;

                if (source === photo.source && photo.renderer) {
                    return true;
                }

                try {
                    if (!photo.renderer) {
                        const gl = canvas.getContext("webgl", {
                            alpha: true,
                            antialias: false,
                            depth: false,
                            stencil: false,
                            powerPreference: "high-performance",
                        });

                        if (!gl) {
                            fail();
                            return false;
                        }

                        photo.renderer = createRenderer(gl);
                    }

                    photo.renderer.upload(image);
                    photo.source = source;
                    canvas.style.display = "block";

                    return true;
                } catch {
                    fail();
                    return false;
                }
            };

            photo.dispose = () => {
                image.removeEventListener("load", loaded);
                image.removeEventListener("error", fail);

                canvas.removeEventListener("webglcontextlost", lost);
                canvas.removeEventListener(
                    "webglcontextrestored",
                    restored,
                );

                image.removeAttribute("data-glass-rendered");

                photo.renderer?.dispose();
                canvas.remove();
            };

            image.addEventListener("load", loaded);
            image.addEventListener("error", fail);

            canvas.addEventListener("webglcontextlost", lost);
            canvas.addEventListener(
                "webglcontextrestored",
                restored,
            );

            return photo;
        }

        function scan() {
            dirty = false;

            const background = scope!.querySelector<HTMLImageElement>(
                ':scope > div[aria-hidden="true"] > img',
            );

            const images = new Set(
                background
                    ? [background]
                    : scope!.querySelectorAll<HTMLImageElement>(
                        'img[src*="/api/cars/"][src*="/photo"]',
                    ),
            );

            for (const [image, photo] of photos) {
                if (!images.has(image)) {
                    photo.dispose();
                    photos.delete(image);
                }
            }

            for (const image of images) {
                const existing = photos.get(image);

                if (!existing) {
                    photos.set(image, createPhoto(image));
                } else if (
                    existing.canvas.className !== image.className
                ) {
                    existing.canvas.className = image.className;
                }
            }

            const elements = new Set(
                scope!.querySelectorAll<HTMLElement>(selector),
            );

            for (const [element, material] of materials) {
                if (!elements.has(element)) {
                    intersections.unobserve(element);
                    active.delete(material);
                    materials.delete(element);

                    element.removeAttribute("data-glass-gpu");
                    marked.delete(element);
                }
            }

            for (const element of elements) {
                const style = window.getComputedStyle(element);
                const width = element.offsetWidth;
                const height = element.offsetHeight;

                const radii: Material["radii"] = [
                    style.borderTopLeftRadius,
                    style.borderTopRightRadius,
                    style.borderBottomRightRadius,
                    style.borderBottomLeftRadius,
                ].map((value) =>
                    radiusValue(value, width, height),
                ) as Material["radii"];

                const existing = materials.get(element);

                if (existing) {
                    existing.radii = radii;
                } else {
                    const material = { element, radii };
                    materials.set(element, material);
                    intersections.observe(element);
                }
            }
        }

        function draw() {
            frame = 0;

            if (disposed || document.hidden) return;
            if (dirty) scan();

            const nextMarked = new Set<HTMLElement>();

            const boxes = reduced.matches
                ? []
                : Array.from(active, (material) => ({
                    material,
                    rect: material.element.getBoundingClientRect(),
                }))
                    .filter(
                        ({ rect }) => rect.width > 0 && rect.height > 0,
                    )
                    .sort(
                        (a, b) =>
                            b.rect.width * b.rect.height -
                            a.rect.width * a.rect.height,
                    );

            for (const photo of photos.values()) {
                const rect = photo.image.getBoundingClientRect();

                if (
                    rect.width <= 1 ||
                    rect.height <= 1 ||
                    rect.bottom < 0 ||
                    rect.top > window.innerHeight ||
                    rect.right < 0 ||
                    rect.left > window.innerWidth
                ) {
                    continue;
                }

                if (!photo.upload() || !photo.renderer) continue;

                const style = window.getComputedStyle(photo.image);
                const naturalWidth = photo.image.naturalWidth;
                const naturalHeight = photo.image.naturalHeight;

                const scale =
                    style.objectFit === "contain"
                        ? Math.min(
                            rect.width / naturalWidth,
                            rect.height / naturalHeight,
                        )
                        : Math.max(
                            rect.width / naturalWidth,
                            rect.height / naturalHeight,
                        );

                const renderedWidth = naturalWidth * scale;
                const renderedHeight = naturalHeight * scale;
                const position = style.objectPosition.split(" ");

                const imageRect: [number, number, number, number] = [
                    positionOffset(
                        position[0],
                        rect.width - renderedWidth,
                    ),
                    positionOffset(
                        position[1] || "50%",
                        rect.height - renderedHeight,
                    ),
                    renderedWidth,
                    renderedHeight,
                ];

                const overlapping = boxes
                    .filter(
                        ({ rect: box }) =>
                            box.bottom > rect.top &&
                            box.top < rect.bottom &&
                            box.right > rect.left &&
                            box.left < rect.right,
                    )
                    .slice(0, photo.renderer.capacity);

                const lenses: Lens[] = overlapping.map(
                    ({ material, rect: box }) => ({
                        rect: [
                            box.left - rect.left,
                            box.top - rect.top,
                            box.width,
                            box.height,
                        ],
                        radii: material.radii,
                    }),
                );

                const density = Math.min(
                    window.devicePixelRatio || 1,
                    1.5,
                );

                const width = Math.max(
                    1,
                    Math.round(rect.width * density),
                );

                const height = Math.max(
                    1,
                    Math.round(rect.height * density),
                );

                if (
                    photo.canvas.width !== width ||
                    photo.canvas.height !== height
                ) {
                    photo.canvas.width = width;
                    photo.canvas.height = height;
                }

                photo.renderer.draw(
                    rect.width,
                    rect.height,
                    imageRect,
                    lenses,
                );

                photo.image.setAttribute(
                    "data-glass-rendered",
                    "",
                );

                for (const { material } of overlapping) {
                    nextMarked.add(material.element);
                }
            }

            for (const element of marked) {
                if (!nextMarked.has(element)) {
                    element.removeAttribute("data-glass-gpu");
                    marked.delete(element);
                }
            }

            for (const element of nextMarked) {
                if (!marked.has(element)) {
                    element.setAttribute("data-glass-gpu", "");
                    marked.add(element);
                }
            }

            if (photos.size) {
                frame = window.requestAnimationFrame(draw);
            }
        }

        function schedule() {
            if (!frame && !disposed && !document.hidden) {
                frame = window.requestAnimationFrame(draw);
            }
        }

        const mutations = new MutationObserver((records) => {
            const relevant = records.some((record) => {
                if (
                    record.target instanceof Element &&
                    record.target.hasAttribute("data-glass-renderer")
                ) {
                    return false;
                }

                if (record.type === "childList") {
                    const changed = [
                        ...record.addedNodes,
                        ...record.removedNodes,
                    ];

                    if (
                        changed.length &&
                        changed.every(
                            (node) =>
                                node instanceof Element &&
                                node.hasAttribute("data-glass-renderer"),
                        )
                    ) {
                        return false;
                    }
                }

                return true;
            });

            if (relevant) {
                dirty = true;
                schedule();
            }
        });

        mutations.observe(scope, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "class",
                "src",
                "srcset",
                "open",
                "hidden",
                "data-photo-ready",
            ],
        });

        function resize() {
            dirty = true;
            schedule();
        }

        function visibility() {
            if (document.hidden) {
                window.cancelAnimationFrame(frame);
                frame = 0;
            } else {
                dirty = true;
                schedule();
            }
        }

        window.addEventListener("resize", resize);
        document.addEventListener(
            "visibilitychange",
            visibility,
        );

        schedule();

        return () => {
            disposed = true;

            window.cancelAnimationFrame(frame);
            mutations.disconnect();
            intersections.disconnect();

            window.removeEventListener("resize", resize);
            document.removeEventListener(
                "visibilitychange",
                visibility,
            );

            for (const photo of photos.values()) {
                photo.dispose();
            }

            for (const element of marked) {
                element.removeAttribute("data-glass-gpu");
            }
        };
    }, [root, selector]);
}