import { randomInt } from "node:crypto";
import { hashSecret, randomId, randomSecret, safeEqual } from "../auth/secrets";
import type { Store } from "../store/store";

const CODE_TTL_MS = 10 * 60_000;

interface PendingPairing {
  id: string;
  code: string;
  pollSecretHash: string;
  pcName: string;
  expiresAt: number;
  /** Set once a signed-in user claims the code; handed to the PC on its next poll. */
  result?: { deviceId: string; deviceSecret: string };
  /** True while a claim is being saved, so the code can't be claimed twice. */
  claiming?: boolean;
}

export type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "paired"; deviceId: string; deviceSecret: string };

/**
 * PC linking flow:
 *  1. The agent calls start() and shows the 6-digit code on screen.
 *  2. The signed-in user types that code into the web/phone app -> claim().
 *  3. The agent's next poll() receives its permanent device id + secret.
 *
 * The code is only a short-lived, single-use rendezvous (10 minutes, and
 * guesses are rate-limited per user and IP by the HTTP layer). The long-term
 * credential is a 256-bit random secret the user never sees or types.
 * The poll secret stops anyone else who learns the pairing id from
 * collecting that credential.
 */
export class PairingService {
  private pending = new Map<string, PendingPairing>();

  constructor(private readonly store: Store) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  start(pcName: string): { pairingId: string; pollSecret: string; code: string; expiresAt: string } {
    this.sweep();
    let code: string;
    do code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    while (this.findByCode(code));

    const pollSecret = randomSecret();
    const entry: PendingPairing = {
      id: randomId("pair"),
      code,
      pollSecretHash: hashSecret(pollSecret),
      pcName: pcName.slice(0, 64) || "My PC",
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    this.pending.set(entry.id, entry);
    return { pairingId: entry.id, pollSecret, code, expiresAt: new Date(entry.expiresAt).toISOString() };
  }

  /** Returns the new PC's id and name, or null if the code is wrong/expired/used. */
  async claim(userId: string, rawCode: string): Promise<{ id: string; name: string } | null> {
    const code = rawCode.replace(/\D/g, "");
    const entry = this.findByCode(code);
    if (!entry || entry.result || entry.claiming || entry.expiresAt < Date.now()) return null;

    // Mark it used before the async insert so two simultaneous claims of
    // the same code can't both succeed.
    const deviceId = randomId("pc");
    const deviceSecret = randomSecret();
    const now = new Date().toISOString();
    entry.claiming = true;
    try {
      await this.store.createPc(deviceId, {
        ownerId: userId,
        secretHash: hashSecret(deviceSecret),
        name: entry.pcName,
        createdAt: now,
        lastSeen: now,
        lanDevices: [],
      });
    } catch (err) {
      entry.claiming = false; // let the user retry the same code
      throw err;
    }
    // Only now hand the credential to the PC's poll: the row exists, so its
    // first WebSocket login will succeed.
    entry.result = { deviceId, deviceSecret };
    return { id: deviceId, name: entry.pcName };
  }

  poll(pairingId: string, pollSecret: string): PollResult {
    const entry = this.pending.get(pairingId);
    if (!entry || !safeEqual(hashSecret(pollSecret), entry.pollSecretHash)) return { status: "expired" };
    if (entry.result) {
      this.pending.delete(pairingId); // hand the secret out exactly once
      return { status: "paired", ...entry.result };
    }
    if (entry.expiresAt < Date.now()) {
      this.pending.delete(pairingId);
      return { status: "expired" };
    }
    return { status: "pending" };
  }

  private findByCode(code: string): PendingPairing | undefined {
    for (const entry of this.pending.values()) if (entry.code === code) return entry;
    return undefined;
  }

  private sweep(): void {
    // Keep claimed-but-not-yet-polled entries a little longer so a PC that
    // was briefly offline can still collect its credential.
    const cutoff = Date.now() - CODE_TTL_MS;
    for (const [id, e] of this.pending) if (e.expiresAt < (e.result ? cutoff : Date.now())) this.pending.delete(id);
  }
}
