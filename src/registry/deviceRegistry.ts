import type { LanDevice, PcRecord, PcSummary } from "../types/device";

/**
 * Storage-agnostic contract for the PC/device registry. Handlers depend on
 * this interface, not on any particular storage — swap FileDeviceRegistry
 * for a Postgres-backed one later without touching WS handling code.
 */
export interface DeviceRegistry {
  upsertPc(deviceId: string, name?: string): void;
  setLanDevices(deviceId: string, devices: LanDevice[]): void;
  /**
   * `onlineIds` comes from the live ConnectionHub, not from stored state —
   * "online" is never persisted, it's always derived from who currently has
   * a socket open.
   */
  listPcs(onlineIds: ReadonlySet<string>): PcSummary[];
}

export interface RegistryState {
  pcs: Record<string, PcRecord>;
}
