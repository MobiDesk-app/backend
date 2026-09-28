import { hashSecret, safeEqual } from "./secrets";

/**
 * Tokens handed to clients look like "<recordId>.<secret>": the id finds the
 * record directly, then the secret is checked against its stored hash in
 * constant time.
 */
export function splitToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

export function secretMatches(secret: string, storedHash: string): boolean {
  return safeEqual(hashSecret(secret), storedHash);
}
