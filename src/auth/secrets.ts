import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of randomness, URL-safe. Used for session tokens and PC secrets. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomId(prefix: string, bytes = 9): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

/**
 * Secrets we generate are high-entropy random values, so a plain SHA-256 is
 * enough to store them safely (slow hashing like scrypt only matters for
 * human-chosen passwords). Only the hash is ever written to disk.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
