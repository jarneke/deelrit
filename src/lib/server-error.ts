import "server-only";

const connectionErrorCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "EPIPE",
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function getErrorCode(error: unknown): string {
    if (typeof error !== "object" || error === null) {
        return "UNKNOWN";
    }

    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code: unknown = descriptor?.value;

    if (typeof code !== "string") {
        return "UNKNOWN";
    }

    if (/^[0-9A-Z]{5}$/.test(code) || connectionErrorCodes.has(code)) {
        return code;
    }

    return "UNKNOWN";
}

function getErrorType(error: unknown): string {
    if (error instanceof TypeError) {
        return "TypeError";
    }

    if (error instanceof RangeError) {
        return "RangeError";
    }

    if (error instanceof SyntaxError) {
        return "SyntaxError";
    }

    return error instanceof Error ? "Error" : "UnknownError";
}

/**
 * Gebruik voor action uitsluitend een vaste interne actienaam.
 * Geef geen formulierwaarden, tokens of verbindingsgegevens mee.
 */
export function logServerError(action: string, error: unknown): void {
    console.error("[Deelrit] Serveractie mislukt", {
        timestamp: new Date().toISOString(),
        action,
        errorType: getErrorType(error),
        errorCode: getErrorCode(error),
    });
}