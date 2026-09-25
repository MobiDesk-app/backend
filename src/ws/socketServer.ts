import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { authMessageSchema, clientMessageSchema } from "../types/messages";
import type { ServerMessage } from "../types/messages";
import { isValidToken } from "../auth/token";
import { ConnectionHub } from "./connectionHub";
import type { DeviceRegistry } from "../registry/deviceRegistry";
import type { Role } from "../types/device";
import { dispatch } from "./handlers/dispatch";

const AUTH_TIMEOUT_MS = 10_000;

export interface SocketServerDeps {
  httpServer: HttpServer;
  registry: DeviceRegistry;
  authToken: string;
}

/**
 * Wires the WebSocket server to the HTTP server and enforces the protocol:
 * the first message on every connection must be a valid `auth` message,
 * everything after that is validated against clientMessageSchema and handed
 * to `dispatch`.
 */
export function createSocketServer({ httpServer, registry, authToken }: SocketServerDeps): ConnectionHub {
  const hub = new ConnectionHub();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    let deviceId: string | null = null;
    let role: Role | null = null;

    const send = (message: ServerMessage) => ws.send(JSON.stringify(message));

    const authTimer = setTimeout(() => {
      if (!deviceId) ws.close(4001, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw: Buffer) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        return send({ type: "error", message: "invalid json" });
      }

      // --- Step 1: first message on the socket must be a valid auth message ---
      if (!deviceId) {
        const authResult = authMessageSchema.safeParse(parsedJson);
        if (!authResult.success) return ws.close(4002, "auth required");

        const auth = authResult.data;
        if (!isValidToken(auth.token, authToken)) return ws.close(4003, "invalid token");

        deviceId = auth.deviceId;
        role = auth.role;
        clearTimeout(authTimer);
        hub.register(deviceId, ws, role);
        if (role === "pc") registry.upsertPc(deviceId, auth.name);
        return send({ type: "auth_ok", deviceId, role });
      }

      // --- Step 2: authenticated traffic, validated against the schema ---
      const messageResult = clientMessageSchema.safeParse(parsedJson);
      if (!messageResult.success) {
        return send({ type: "error", message: "invalid message" });
      }

      dispatch({ deviceId, role: role as Role, hub, registry, send }, messageResult.data);
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (deviceId) hub.unregister(deviceId);
    });
  });

  return hub;
}
