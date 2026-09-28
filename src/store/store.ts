import type { LanDevice, PcRecord, PcSummary, SessionRecord, UserRecord } from "../types/device";

/**
 * Storage-agnostic contract. Routes and handlers depend only on this, so the
 * backing store can be Postgres (production, DATABASE_URL set) or a local
 * JSON file (quick local dev) without any other code changing.
 */
export interface Store {
  /** Create tables / load file. Called once before the server starts. */
  init(): Promise<void>;
  close(): Promise<void>;

  // users
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  getUser(id: string): Promise<UserRecord | undefined>;
  /** Returns false if the email is already taken. */
  createUser(user: UserRecord): Promise<boolean>;

  // sessions (one per signed-in browser/phone)
  getSession(id: string): Promise<SessionRecord | undefined>;
  createSession(session: SessionRecord): Promise<void>;
  touchSession(id: string, expiresAt: string): Promise<void>;
  deleteSession(id: string): Promise<void>;

  // PCs
  getPc(id: string): Promise<(PcRecord & { id: string }) | undefined>;
  createPc(id: string, pc: PcRecord): Promise<void>;
  deletePc(id: string): Promise<void>;
  markPcSeen(id: string, name?: string): Promise<void>;
  setLanDevices(id: string, devices: LanDevice[]): Promise<void>;
  /** `onlineIds` comes from live sockets — "online" is never stored. */
  listPcsForUser(userId: string, onlineIds: ReadonlySet<string>): Promise<PcSummary[]>;
}

export interface StoreState {
  version: 2;
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  pcs: Record<string, PcRecord>;
}
