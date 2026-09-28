import { Pool } from "pg";
import type { Store } from "./store";
import type { LanDevice, PcRecord, PcSummary, SessionRecord, UserRecord } from "../types/device";

// Tables are created automatically on startup (idempotent), so a fresh
// database just works. Deleting a user removes their sessions and PCs.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash  TEXT NOT NULL,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS pcs (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  lan_devices JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS pcs_owner_id_idx ON pcs(owner_id);
`;

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

interface UserRow { id: string; email: string; password_hash: string; created_at: Date }
interface SessionRow { id: string; user_id: string; secret_hash: string; name: string; created_at: Date; last_used_at: Date; expires_at: Date }
interface PcRow { id: string; owner_id: string; secret_hash: string; name: string; created_at: Date; last_seen: Date; lan_devices: LanDevice[] }

const toUser = (r: UserRow): UserRecord => ({ id: r.id, email: r.email, passwordHash: r.password_hash, createdAt: iso(r.created_at) });
const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  userId: r.user_id,
  secretHash: r.secret_hash,
  name: r.name,
  createdAt: iso(r.created_at),
  lastUsedAt: iso(r.last_used_at),
  expiresAt: iso(r.expires_at),
});
const toPc = (r: PcRow): PcRecord & { id: string } => ({
  id: r.id,
  ownerId: r.owner_id,
  secretHash: r.secret_hash,
  name: r.name,
  createdAt: iso(r.created_at),
  lastSeen: iso(r.last_seen),
  lanDevices: r.lan_devices ?? [],
});

/** PostgreSQL store (e.g. Neon). Used whenever DATABASE_URL is set. */
export class PgStore implements Store {
  private readonly pool: Pool;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // An idle client losing its connection (e.g. Neon scaling to zero) must
    // not crash the process; the pool simply opens a new one next time.
    this.pool.on("error", (err) => console.warn("[db] idle client error:", err.message));
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
    await this.deleteExpiredSessions();
    this.cleanupTimer = setInterval(() => void this.deleteExpiredSessions().catch(() => {}), 60 * 60_000);
    this.cleanupTimer.unref();
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.pool.end();
  }

  private async deleteExpiredSessions(): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE expires_at < now()");
  }

  // --- users ---
  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async getUser(id: string): Promise<UserRecord | undefined> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async createUser(user: UserRecord): Promise<boolean> {
    // ON CONFLICT makes "two sign-ups with the same email at once" safe.
    const { rowCount } = await this.pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
      [user.id, user.email, user.passwordHash, user.createdAt]
    );
    return rowCount === 1;
  }

  // --- sessions ---
  async getSession(id: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.pool.query<SessionRow>("SELECT * FROM sessions WHERE id = $1 AND expires_at > now()", [id]);
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async createSession(s: SessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, secret_hash, name, created_at, last_used_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [s.id, s.userId, s.secretHash, s.name, s.createdAt, s.lastUsedAt, s.expiresAt]
    );
  }

  async touchSession(id: string, expiresAt: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET last_used_at = now(), expires_at = $2 WHERE id = $1", [id, expiresAt]);
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  // --- PCs ---
  async getPc(id: string): Promise<(PcRecord & { id: string }) | undefined> {
    const { rows } = await this.pool.query<PcRow>("SELECT * FROM pcs WHERE id = $1", [id]);
    return rows[0] ? toPc(rows[0]) : undefined;
  }

  async createPc(id: string, pc: PcRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pcs (id, owner_id, secret_hash, name, created_at, last_seen, lan_devices)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [id, pc.ownerId, pc.secretHash, pc.name, pc.createdAt, pc.lastSeen, JSON.stringify(pc.lanDevices)]
    );
  }

  async deletePc(id: string): Promise<void> {
    await this.pool.query("DELETE FROM pcs WHERE id = $1", [id]);
  }

  async markPcSeen(id: string, name?: string): Promise<void> {
    await this.pool.query("UPDATE pcs SET last_seen = now(), name = COALESCE($2, name) WHERE id = $1", [id, name ?? null]);
  }

  async setLanDevices(id: string, devices: LanDevice[]): Promise<void> {
    await this.pool.query("UPDATE pcs SET lan_devices = $2::jsonb, last_seen = now() WHERE id = $1", [id, JSON.stringify(devices)]);
  }

  async listPcsForUser(userId: string, onlineIds: ReadonlySet<string>): Promise<PcSummary[]> {
    const { rows } = await this.pool.query<PcRow>("SELECT * FROM pcs WHERE owner_id = $1 ORDER BY created_at", [userId]);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lastSeen: iso(r.last_seen),
      lanDevices: r.lan_devices ?? [],
      online: onlineIds.has(r.id),
    }));
  }
}
