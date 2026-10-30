import "server-only";

import { createHash, randomUUID } from "node:crypto";

const owner = "jarneke";
const repository = "Deelrit-image-store";
const defaultPath = "defaults/car.jpg";

type PhotoKind = "cars" | "profiles";

const maximumUploadBytes = 700 * 1024;
const maximumReadBytes = 5 * 1024 * 1024;

const apiBase =
    `https://api.github.com/repos/${owner}/${repository}/contents/`;

let mutationQueue: Promise<void> = Promise.resolve();

export class GitHubImageError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = "GitHubImageError";
    }
}

function getBranch(): string {
    const branch = process.env.DEELRIT_IMAGES_BRANCH?.trim() || "main";

    if (!/^[a-zA-Z0-9._-]+$/.test(branch)) {
        throw new GitHubImageError(
            "De ingestelde afbeeldingenbranch is ongeldig.",
        );
    }

    return branch;
}

function getHeaders(raw = false): Record<string, string> {
    const token = process.env.DEELRIT_IMAGES_TOKEN?.trim();

    if (!token) {
        throw new GitHubImageError(
            "De GitHub-configuratie voor afbeeldingen ontbreekt.",
        );
    }

    return {
        Authorization: `Bearer ${token}`,
        Accept: raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
    };
}

function encodePath(path: string): string {
    return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
}

function apiUrl(path: string): string {
    return `${apiBase}${encodePath(path)}`;
}

function rawUrl(path: string): string {
    return (
        `https://raw.githubusercontent.com/${owner}/${repository}/` +
        `${encodeURIComponent(getBranch())}/${encodePath(path)}`
    );
}

function imageFolder(kind: PhotoKind, entityId: string): string {
    const key = createHash("sha256")
        .update(entityId)
        .digest("hex")
        .slice(0, 24);

    return `${kind}/${key}/`;
}

function ownedPath(
    kind: PhotoKind,
    entityId: string,
    photoUrl: string | null,
): string | null {
    if (!photoUrl) return null;

    try {
        const candidate = new URL(photoUrl);
        const prefix = new URL(rawUrl(imageFolder(kind, entityId)));

        if (
            candidate.origin !== prefix.origin ||
            candidate.search !== "" ||
            candidate.hash !== "" ||
            !candidate.pathname.startsWith(prefix.pathname)
        ) {
            return null;
        }

        const fileName = candidate.pathname.slice(prefix.pathname.length);

        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i.test(
                fileName,
            )
        ) {
            return null;
        }

        return `${imageFolder(kind, entityId)}${fileName}`;
    } catch {
        return null;
    }
}

function serializeMutation<T>(
    operation: () => Promise<T>,
): Promise<T> {
    const result = mutationQueue.then(operation);

    mutationQueue = result.then(
        () => undefined,
        () => undefined,
    );

    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isJpeg(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
    );
}

function photoSource(
    kind: PhotoKind,
    entityId: string,
    photoUrl: string | null,
): string {
    const version = createHash("sha256")
        .update(photoUrl || "default")
        .digest("hex")
        .slice(0, 16);

    return (
        `/api/${kind === "cars" ? "cars" : "users"}/${encodeURIComponent(entityId)}/photo` +
        `?v=${version}`
    );
}

async function uploadPhoto(
    kind: PhotoKind,
    entityId: string,
    file: File,
): Promise<string> {
    if (
        file.type !== "image/jpeg" ||
        file.size === 0 ||
        file.size > maximumUploadBytes
    ) {
        throw new GitHubImageError(
            "Gebruik een verwerkte JPEG-foto van maximaal 700 KB.",
        );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!isJpeg(buffer)) {
        throw new GitHubImageError("Het bestand is geen geldige JPEG-foto.");
    }

    const branch = getBranch();
    const path = `${imageFolder(kind, entityId)}${randomUUID()}.jpg`;

    return serializeMutation(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const response = await fetch(apiUrl(path), {
                method: "PUT",
                headers: getHeaders(),
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
                body: JSON.stringify({
                    message:
                        kind === "cars"
                            ? "Add car photo"
                            : "Add profile photo",
                    content: buffer.toString("base64"),
                    branch,
                }),
            });

            if (response.status === 409 && attempt < 2) {
                continue;
            }

            if (!response.ok) {
                throw new GitHubImageError(
                    "De foto kon niet naar GitHub worden geüpload.",
                    response.status,
                );
            }

            return rawUrl(path);
        }

        throw new GitHubImageError(
            "GitHub is momenteel bezig. Probeer de foto opnieuw op te slaan.",
        );
    });
}

async function removePhoto(
    kind: PhotoKind,
    entityId: string,
    photoUrl: string,
): Promise<void> {
    const path = ownedPath(kind, entityId, photoUrl);

    if (!path) return;

    const branch = getBranch();

    await serializeMutation(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const fileResponse = await fetch(
                `${apiUrl(path)}?ref=${encodeURIComponent(branch)}`,
                {
                    headers: getHeaders(),
                    cache: "no-store",
                    signal: AbortSignal.timeout(10_000),
                },
            );

            if (fileResponse.status === 404) {
                return;
            }

            if (!fileResponse.ok) {
                throw new GitHubImageError(
                    "De oude foto kon niet op GitHub worden gevonden.",
                    fileResponse.status,
                );
            }

            const fileData: unknown = await fileResponse.json();

            if (
                !isRecord(fileData) ||
                fileData.type !== "file" ||
                typeof fileData.sha !== "string"
            ) {
                throw new GitHubImageError(
                    "GitHub gaf ongeldige afbeeldingsgegevens terug.",
                );
            }

            const deleteResponse = await fetch(apiUrl(path), {
                method: "DELETE",
                headers: getHeaders(),
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
                body: JSON.stringify({
                    message:
                        kind === "cars"
                            ? "Remove car photo"
                            : "Remove profile photo",
                    sha: fileData.sha,
                    branch,
                }),
            });

            if (deleteResponse.status === 404) {
                return;
            }

            if (deleteResponse.status === 409 && attempt < 2) {
                continue;
            }

            if (!deleteResponse.ok) {
                throw new GitHubImageError(
                    "De oude foto kon niet van GitHub worden verwijderd.",
                    deleteResponse.status,
                );
            }

            return;
        }

        throw new GitHubImageError(
            "GitHub kon het verwijderen van de oude foto niet afronden.",
        );
    });
}

async function readImage(path: string): Promise<ArrayBuffer | null> {
    const response = await fetch(
        `${apiUrl(path)}?ref=${encodeURIComponent(getBranch())}`,
        {
            headers: getHeaders(true),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        },
    );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new GitHubImageError(
            "De foto kon niet worden geladen.",
            response.status,
        );
    }

    const declaredSize = Number(response.headers.get("content-length"));

    if (
        Number.isFinite(declaredSize) &&
        declaredSize > maximumReadBytes
    ) {
        throw new GitHubImageError("De opgeslagen foto is te groot.");
    }

    const buffer = await response.arrayBuffer();

    if (
        buffer.byteLength > maximumReadBytes ||
        !isJpeg(new Uint8Array(buffer))
    ) {
        throw new GitHubImageError(
            "De opgeslagen foto is geen ondersteunde JPEG.",
        );
    }

    return buffer;
}

export function getCarPhotoSource(
    organizationId: string,
    photoUrl: string | null,
): string {
    return photoSource("cars", organizationId, photoUrl);
}

export function uploadCarPhoto(
    organizationId: string,
    file: File,
): Promise<string> {
    return uploadPhoto("cars", organizationId, file);
}

export function removeCarPhoto(
    organizationId: string,
    photoUrl: string,
): Promise<void> {
    return removePhoto("cars", organizationId, photoUrl);
}

export async function readCarPhoto(
    organizationId: string,
    photoUrl: string | null,
): Promise<ArrayBuffer> {
    const path = ownedPath("cars", organizationId, photoUrl);

    if (path) {
        const image = await readImage(path);
        if (image) return image;
    }

    const fallback = await readImage(defaultPath);

    if (!fallback) {
        throw new GitHubImageError(
            "De standaardfoto defaults/car.jpg ontbreekt in de afbeeldingenrepo.",
            404,
        );
    }

    return fallback;
}

export function getProfilePhotoSource(
    userId: string,
    photoUrl: string | null,
): string | null {
    if (!ownedPath("profiles", userId, photoUrl)) return null;
    return photoSource("profiles", userId, photoUrl);
}

export function uploadProfilePhoto(
    userId: string,
    file: File,
): Promise<string> {
    return uploadPhoto("profiles", userId, file);
}

export function removeProfilePhoto(
    userId: string,
    photoUrl: string,
): Promise<void> {
    return removePhoto("profiles", userId, photoUrl);
}

export async function readProfilePhoto(
    userId: string,
    photoUrl: string | null,
): Promise<ArrayBuffer | null> {
    const path = ownedPath("profiles", userId, photoUrl);
    return path ? readImage(path) : null;
}