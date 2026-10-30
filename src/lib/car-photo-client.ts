"use client";

const maximumInputBytes = 20 * 1024 * 1024;
const maximumOutputBytes = 700 * 1024;
const maximumDimension = 1600;

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve(image);

        image.onerror = () => {
            reject(
                new Error(
                    "Deze foto kon niet worden gelezen. Kies een JPEG-, PNG- of WebP-foto.",
                ),
            );
        };

        image.src = url;
    });
}

function jpegBlob(
    canvas: HTMLCanvasElement,
    quality: number,
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob || blob.type !== "image/jpeg") {
                    reject(new Error("De foto kon niet worden verwerkt."));
                    return;
                }

                resolve(blob);
            },
            "image/jpeg",
            quality,
        );
    });
}

export async function prepareCarPhoto(file: File): Promise<File> {
    if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
        throw new Error("Kies een JPEG-, PNG- of WebP-foto.");
    }

    if (file.size === 0 || file.size > maximumInputBytes) {
        throw new Error("Kies een foto van maximaal 20 MB.");
    }

    const objectUrl = URL.createObjectURL(file);

    try {
        const image = await loadImage(objectUrl);

        if (image.naturalWidth === 0 || image.naturalHeight === 0) {
            throw new Error("De foto heeft geen geldige afmetingen.");
        }

        const scale = Math.min(
            1,
            maximumDimension /
            Math.max(image.naturalWidth, image.naturalHeight),
        );

        let width = Math.max(1, Math.round(image.naturalWidth * scale));
        let height = Math.max(1, Math.round(image.naturalHeight * scale));

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Deze browser kon de foto niet verwerken.");
        }

        for (let resize = 0; resize < 4; resize += 1) {
            canvas.width = width;
            canvas.height = height;

            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);

            for (const quality of [0.86, 0.74, 0.62, 0.5]) {
                const blob = await jpegBlob(canvas, quality);

                if (blob.size <= maximumOutputBytes) {
                    return new File([blob], "car-photo.jpg", {
                        type: "image/jpeg",
                        lastModified: Date.now(),
                    });
                }
            }

            width = Math.max(1, Math.round(width * 0.75));
            height = Math.max(1, Math.round(height * 0.75));
        }

        throw new Error(
            "De foto bleef te groot. Kies een kleinere afbeelding.",
        );
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export function carPhotoPreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            if (typeof reader.result !== "string") {
                reject(new Error("Het fotovoorbeeld kon niet worden geladen."));
                return;
            }

            resolve(reader.result);
        };

        reader.onerror = () => {
            reject(new Error("Het fotovoorbeeld kon niet worden geladen."));
        };

        reader.readAsDataURL(file);
    });
}