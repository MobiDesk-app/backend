import type { WebSocket } from "ws";
import type { Role } from "../types/device";
import type { ServerMessage } from "../types/messages";

interface Connection {
  ws: WebSocket;
  role: Role;
}

/** Tracks who currently has a live socket open, keyed by deviceId. */
export class ConnectionHub {
  private connections = new Map<string, Connection>();

  register(deviceId: string, ws: WebSocket, role: Role): void {
    this.connections.set(deviceId, { ws, role });
  }

  unregister(deviceId: string): void {
    this.connections.delete(deviceId);
  }

  sendTo(deviceId: string, message: ServerMessage): boolean {
    const entry = this.connections.get(deviceId);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
    entry.ws.send(JSON.stringify(message));
    return true;
  }

  onlinePcIds(): Set<string> {
    const ids = new Set<string>();
    for (const [id, entry] of this.connections) {
      if (entry.role === "pc") ids.add(id);
    }
    return ids;
  }
}
