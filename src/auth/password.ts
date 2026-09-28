import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt is built into Node (no native addon to compile on Windows/macOS)
// and is deliberately slow and memory-hard, which is what makes offline
// password guessing expensive if the data file ever leaks.
const KEY_LEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, PARAMS, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

/** Returns "scrypt$<N>$<r>$<p>$<salt>$<hash>" so parameters can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, , , , saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Used when the email doesn't exist, so a failed login takes the same time
// either way and can't be used to discover which emails have accounts.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummyHash);
}
