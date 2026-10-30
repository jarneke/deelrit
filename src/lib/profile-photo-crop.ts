"use client";

export type CropPosition = {
    zoom: number;
    x: number;
    y: number;
};

export function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

export function cropBounds(
    width: number,
    height: number,
    position: CropPosition,
) {
    const zoom = clamp(position.zoom, 1, 3);
    const side = Math.min(width, height) / zoom;
    const x = (width - side) * clamp(position.x, 0, 1);
    const y = (height - side) * clamp(position.y, 0, 1);

    return { x, y, side };
}

export function loadCropImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
            if (!image.naturalWidth || !image.naturalHeight) {
                reject(new Error("De foto heeft geen geldige afmetingen."));
                return;
            }

            resolve(image);
        };

        image.onerror = () => {
            reject(new Error("De foto kon niet worden geladen."));
        };

        image.src = source;
    });
}

export async function exportProfileCrop(
    image: HTMLImageElement,
    position: CropPosition,
): Promise<File> {
    const bounds = cropBounds(
        image.naturalWidth,
        image.naturalHeight,
        position,
    );

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;

    const context = canvas.getContext("2d");

    if (!context) {
        throw new Error("Deze browser kon de foto niet verwerken.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 512, 512);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
        image,
        bounds.x,
        bounds.y,
        bounds.side,
        bounds.side,
        0,
        0,
        512,
        512,
    );

    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (result) => {
                    if (!result || result.type !== "image/jpeg") {
                        reject(new Error("De uitsnede kon niet worden verwerkt."));
                        return;
                    }

                    resolve(result);
                },
                "image/jpeg",
                quality,
            );
        });

        if (blob.size <= 700 * 1024) {
            return new File([blob], "profile-photo.jpg", {
                type: "image/jpeg",
            });
        }
    }

    throw new Error("De uitsnede bleef te groot. Kies een andere foto.");
}