import type { Role } from "../types/device";
import type { ServerMessage } from "../types/messages";
import type { ConnectionHub } from "./connectionHub";
import type { DeviceRegistry } from "../registry/deviceRegistry";

/** Everything a message handler needs, without reaching for globals/singletons. */
export interface HandlerContext {
  deviceId: string;
  role: Role;
  hub: ConnectionHub;
  registry: DeviceRegistry;
  send: (message: ServerMessage) => void;
}
