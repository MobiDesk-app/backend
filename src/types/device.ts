export type Role = "pc" | "app";

export interface LanDevice {
  ip: string;
  mac: string;
  name?: string;
}

export interface PcRecord {
  name: string;
  lastSeen: string; // ISO timestamp
  lanDevices: LanDevice[];
}

export interface PcSummary extends PcRecord {
  id: string;
  online: boolean;
}
