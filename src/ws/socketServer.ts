import type { Server as HttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { authMessageSchema, clientMessageSchema } from "../types/messages";
import type { ServerMessage } from "../types/messages";
import { secretMatches } from "../auth/token";
import type { SessionService } from "../auth/sessions";
import type { Store } from "../store/store";
import type { Connection, ConnectionHub } from "./connectionHub";
import { dispatch } from "./handlers/dispatch";

const AUTH_TIMEOUT_MS = 10_000;
// Signaling messages are small (SDP offers are a few KB). ws's default limit
// is 100MB, which would let any client make the server buffer huge frames.
const MAX_PAYLOAD_BYTES = 256 * 1024;
// Detects dead connections (sleeping laptop, dropped Wi-Fi) that never send a
// close frame, and keeps proxies on hosts like Render/Fly from cutting idle
// sockets.
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Close code clients treat as "credentials no longer valid — don't retry". */
export const CLOSE_UNAUTHORIZED = 4003;

export interface SocketServerDeps {
  httpServer: HttpServer;
  hub: ConnectionHub;
  store: Store;
  sessions: SessionService;
}

/**
 * Wires the WebSocket server to the HTTP server and enforces the protocol:
 * the first message on every connection must be a valid `auth` message,
 * everything after that is validated against clientMessageSchema and handed
 * to `dispatch`.
 */
export function createSocketServer({ httpServer, hub, store, sessions }: SocketServerDeps): void {
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate(); // fires "close", which unregisters it
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws: WebSocket) => {
    let conn: Connection | null = null;

    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    // Without a listener, a malformed frame from any client emits an
    // unhandled "error" event and crashes the whole server.
    ws.on("error", (err) => {
      console.warn(`[ws] socket error${conn ? ` (${conn.id})` : ""}: ${err.message}`);
    });

    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };

    const authTimer = setTimeout(() => {
      if (!conn) ws.close(4001, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    // Messages are handled one at a time, in order. Auth and some handlers
    // wait on the database, and a message arriving mid-auth must not be
    // mistaken for a second auth attempt.
    let queue: Promise<void> = Promise.resolve();
    ws.on("message", (raw: Buffer) => {
      queue = queue
        .then(() => handleMessage(raw))
        .catch((err: unknown) => {
          console.error(`[ws] failed handling message${conn ? ` from ${conn.id}` : ""}:`, err instanceof Error ? err.message : err);
          if (!conn) ws.close(1011, "server error");
        });
    });

    const handleMessage = async (raw: Buffer): Promise<void> => {
      if (ws.readyState !== ws.OPEN) return;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        return send({ type: "error", message: "invalid json" });
      }

      // --- Step 1: first message on the socket must be a valid auth message ---
      if (!conn) {
        const authResult = authMessageSchema.safeParse(parsedJson);
        if (!authResult.success) return ws.close(4002, "auth required");
        const auth = authResult.data;

        let authed: Connection;
        if (auth.role === "pc") {
          const pc = await store.getPc(auth.deviceId);
          if (!pc || !secretMatches(auth.secret, pc.secretHash)) return ws.close(CLOSE_UNAUTHORIZED, "invalid credentials");
          authed = { id: auth.deviceId, ws, role: "pc", userId: pc.ownerId };
          await store.markPcSeen(auth.deviceId, auth.name);
        } else {
          const verified = await sessions.verify(auth.sessionToken);
          if (!verified) return ws.close(CLOSE_UNAUTHORIZED, "invalid session");
          authed = {
            id: `app_${randomBytes(9).toString("base64url")}`,
            ws,
            role: "app",
            userId: verified.user.id,
            sessionId: verified.session.id,
          };
        }

        // The socket may have closed while we were waiting on the database;
        // registering it now would leave a dead entry in the hub.
        if (ws.readyState !== ws.OPEN) return;
        conn = authed;
        clearTimeout(authTimer);
        const previous = hub.register(conn);
        previous?.close(4004, "replaced by a newer connection");
        return send({ type: "auth_ok", deviceId: conn.id, role: conn.role });
      }

      // --- Step 2: authenticated traffic, validated against the schema ---
      const messageResult = clientMessageSchema.safeParse(parsedJson);
      if (!messageResult.success) {
        return send({ type: "error", message: "invalid message" });
      }

      await dispatch({ conn, hub, store, send }, messageResult.data);
    };

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (conn) hub.unregister(conn.id, ws);
    });
  });
}
