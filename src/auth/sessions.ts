import { randomId, randomSecret, hashSecret } from "./secrets";
import { splitToken, secretMatches } from "./token";
import type { Store } from "../store/store";
import type { SessionRecord, UserRecord } from "../types/device";

// Sliding expiry: a session you keep using never expires; one left unused
// for this long does.
const SESSION_TTL_MS = 60 * 24 * 60 * 60_000;
const TOUCH_EVERY_MS = 60 * 60_000;

export class SessionService {
  constructor(private readonly store: Store) {}

  /** Returns the bearer token the client keeps. Only its hash is stored. */
  async create(userId: string, name: string): Promise<string> {
    const secret = randomSecret();
    const now = new Date();
    const session: SessionRecord = {
      id: randomId("ses"),
      userId,
      secretHash: hashSecret(secret),
      name: name.slice(0, 64) || "Unknown device",
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    await this.store.createSession(session);
    return `${session.id}.${secret}`;
  }

  async verify(token: string | undefined): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    if (!token) return null;
    const parts = splitToken(token);
    if (!parts) return null;
    const session = await this.store.getSession(parts.id);
    if (!session || !secretMatches(parts.secret, session.secretHash)) return null;
    const user = await this.store.getUser(session.userId);
    if (!user) return null;
    if (Date.now() - Date.parse(session.lastUsedAt) > TOUCH_EVERY_MS) {
      await this.store.touchSession(session.id, new Date(Date.now() + SESSION_TTL_MS).toISOString());
    }
    return { session, user };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.store.deleteSession(sessionId);
  }
}
