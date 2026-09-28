import type { WebSocket } from "ws";
import type { Role } from "../types/device";
import type { ServerMessage } from "../types/messages";

export interface Connection {
  /** PC: its device id. App: a per-socket id assigned by the server. */
  id: string;
  ws: WebSocket;
  role: Role;
  /** The account this connection acts for (a PC's owner, or the signed-in user). */
  userId: string;
  /** Apps only: which sign-in session opened this socket. */
  sessionId?: string;
}

/** Tracks who currently has a live socket open, keyed by connection id. */
export class ConnectionHub {
  private connections = new Map<string, Connection>();

  /**
   * Returns the socket previously registered under this id (if any) so the
   * caller can close it — a reconnecting agent often opens its new socket
   * before the old one has finished closing.
   */
  register(conn: Connection): WebSocket | undefined {
    const previous = this.connections.get(conn.id)?.ws;
    this.connections.set(conn.id, conn);
    return previous !== conn.ws ? previous : undefined;
  }

  /**
   * Only removes the entry if it still belongs to `ws`. Without this check a
   * stale socket closing late would unregister the device's *new* socket and
   * make an online PC look offline.
   */
  unregister(id: string, ws: WebSocket): void {
    if (this.connections.get(id)?.ws === ws) this.connections.delete(id);
  }

  get(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  sendTo(id: string, message: ServerMessage): boolean {
    const entry = this.connections.get(id);
    if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
    entry.ws.send(JSON.stringify(message));
    return true;
  }

  closeWhere(match: (c: Connection) => boolean, code: number, reason: string): void {
    for (const c of this.connections.values()) if (match(c)) c.ws.close(code, reason);
  }

  onlinePcIds(): Set<string> {
    const ids = new Set<string>();
    for (const [id, entry] of this.connections) if (entry.role === "pc") ids.add(id);
    return ids;
  }
}
