import crypto from "crypto";

const PREFIX = "svm_live_";

/** Generate a new opaque API key. The raw value is only ever returned once. */
export function generateApiKey(): string {
  return PREFIX + crypto.randomBytes(24).toString("hex");
}

/** Deterministic hash used for storage + lookup. Keys are high-entropy, so a
 * fast hash is fine here (unlike user passwords). */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function last4(rawKey: string): string {
  return rawKey.slice(-4);
}

/** Pull the API key out of an incoming request's headers. Supports both
 * `Authorization: Bearer <key>` and `x-api-key: <key>`. */
export function extractApiKey(headers: {
  authorization?: string;
  "x-api-key"?: string | string[];
}): string | undefined {
  const auth = headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const x = headers["x-api-key"];
  if (Array.isArray(x)) return x[0];
  return x;
}
