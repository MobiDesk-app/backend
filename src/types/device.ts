export type Role = "pc" | "app";

export interface LanDevice {
  ip: string;
  mac: string;
  name?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  secretHash: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface PcRecord {
  ownerId: string;
  secretHash: string;
  name: string;
  createdAt: string;
  lastSeen: string;
  lanDevices: LanDevice[];
}

/** What clients see — never includes owner or secret hashes. */
export interface PcSummary {
  id: string;
  name: string;
  lastSeen: string;
  lanDevices: LanDevice[];
  online: boolean;
}
