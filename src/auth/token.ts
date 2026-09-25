// MVP auth: one shared secret checked against every connecting client.
// Fine for "just me"; move to per-device issued tokens before that changes.
// See README "Not done yet" for the upgrade path.
export function isValidToken(token: string, expected: string): boolean {
  return token.length > 0 && token === expected;
}
