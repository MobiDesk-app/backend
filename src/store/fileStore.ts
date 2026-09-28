import fs from "node:fs";
import path from "node:path";
import type { Store, StoreState } from "./store";
import type { LanDevice, PcRecord, PcSummary, SessionRecord, UserRecord } from "../types/device";

const SAVE_DEBOUNCE_MS = 250;

/**
 * JSON-file store, used when DATABASE_URL isn't set (quick local dev).
 * Writes are debounced and atomic (write temp file, then rename) so a crash
 * mid-write can't leave a half-written, unparseable file behind.
 */
export class FileStore implements Store {
  private state: StoreState;
  private emailIndex = new Map<string, string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath: string) {
    this.state = { version: 2, users: {}, sessions: {}, pcs: {} };
  }

  async init(): Promise<void> {
    this.state = this.load();
    for (const user of Object.values(this.state.users)) this.emailIndex.set(user.email, user.id);
    this.pruneExpiredSessions();
    process.once("exit", () => this.flush());
  }

  async close(): Promise<void> {
    this.flush();
  }

  private load(): StoreState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<StoreState>;
      if (parsed.version === 2) return parsed as StoreState;
    } catch {
      // missing or unreadable -> start fresh
    }
    return { version: 2, users: {}, sessions: {}, pcs: {} };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  private pruneExpiredSessions(): void {
    const now = new Date().toISOString();
    for (const [id, s] of Object.entries(this.state.sessions)) if (s.expiresAt < now) delete this.state.sessions[id];
  }

  // --- users ---
  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const id = this.emailIndex.get(email);
    return id ? this.state.users[id] : undefined;
  }
  async getUser(id: string): Promise<UserRecord | undefined> {
    return this.state.users[id];
  }
  async createUser(user: UserRecord): Promise<boolean> {
    if (this.emailIndex.has(user.email)) return false;
    this.state.users[user.id] = user;
    this.emailIndex.set(user.email, user.id);
    this.scheduleSave();
    return true;
  }

  // --- sessions ---
  async getSession(id: string): Promise<SessionRecord | undefined> {
    const s = this.state.sessions[id];
    if (s && s.expiresAt < new Date().toISOString()) {
      await this.deleteSession(id);
      return undefined;
    }
    return s;
  }
  async createSession(session: SessionRecord): Promise<void> {
    this.state.sessions[session.id] = session;
    this.scheduleSave();
  }
  async touchSession(id: string, expiresAt: string): Promise<void> {
    const s = this.state.sessions[id];
    if (!s) return;
    s.lastUsedAt = new Date().toISOString();
    s.expiresAt = expiresAt;
    this.scheduleSave();
  }
  async deleteSession(id: string): Promise<void> {
    delete this.state.sessions[id];
    this.scheduleSave();
  }

  // --- PCs ---
  async getPc(id: string): Promise<(PcRecord & { id: string }) | undefined> {
    const pc = this.state.pcs[id];
    return pc ? { id, ...pc } : undefined;
  }
  async createPc(id: string, pc: PcRecord): Promise<void> {
    this.state.pcs[id] = pc;
    this.scheduleSave();
  }
  async deletePc(id: string): Promise<void> {
    delete this.state.pcs[id];
    this.scheduleSave();
  }
  async markPcSeen(id: string, name?: string): Promise<void> {
    const pc = this.state.pcs[id];
    if (!pc) return;
    pc.lastSeen = new Date().toISOString();
    if (name) pc.name = name;
    this.scheduleSave();
  }
  async setLanDevices(id: string, devices: LanDevice[]): Promise<void> {
    const pc = this.state.pcs[id];
    if (!pc) return;
    pc.lanDevices = devices;
    pc.lastSeen = new Date().toISOString();
    this.scheduleSave();
  }
  async listPcsForUser(userId: string, onlineIds: ReadonlySet<string>): Promise<PcSummary[]> {
    return Object.entries(this.state.pcs)
      .filter(([, pc]) => pc.ownerId === userId)
      .map(([id, pc]) => ({
        id,
        name: pc.name,
        lastSeen: pc.lastSeen,
        lanDevices: pc.lanDevices,
        online: onlineIds.has(id),
      }));
  }
}
