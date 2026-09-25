import fs from "node:fs";
import path from "node:path";
import type { DeviceRegistry, RegistryState } from "./deviceRegistry";
import type { LanDevice, PcSummary } from "../types/device";

/** Flat-file backed registry. Adequate for a single-user MVP. */
export class FileDeviceRegistry implements DeviceRegistry {
  private state: RegistryState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  private load(): RegistryState {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw) as RegistryState;
    } catch {
      return { pcs: {} };
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  upsertPc(deviceId: string, name?: string): void {
    const existing = this.state.pcs[deviceId];
    this.state.pcs[deviceId] = {
      name: name ?? existing?.name ?? deviceId,
      lastSeen: new Date().toISOString(),
      lanDevices: existing?.lanDevices ?? [],
    };
    this.save();
  }

  setLanDevices(deviceId: string, devices: LanDevice[]): void {
    const existing = this.state.pcs[deviceId];
    this.state.pcs[deviceId] = {
      name: existing?.name ?? deviceId,
      lastSeen: new Date().toISOString(),
      lanDevices: devices,
    };
    this.save();
  }

  listPcs(onlineIds: ReadonlySet<string>): PcSummary[] {
    return Object.entries(this.state.pcs).map(([id, pc]) => ({
      id,
      ...pc,
      online: onlineIds.has(id),
    }));
  }
}
