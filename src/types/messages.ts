import { z } from "zod";
import type { PcSummary } from "./device";

// ---------------------------------------------------------------------------
// Inbound (client -> server), validated at runtime with zod since this is
// untrusted input coming straight off a WebSocket.
// ---------------------------------------------------------------------------

// zod's .optional() types the field as `T | undefined`, which trips
// exactOptionalPropertyTypes against LanDevice (`name?: string`, no
// `undefined` in the type). Transform drops the key entirely when absent so
// the runtime shape actually matches the type.
const lanDeviceSchema = z
  .object({
    ip: z.string(),
    mac: z.string(),
    name: z.string().optional(),
  })
  .transform(({ name, ...rest }) => (name === undefined ? rest : { ...rest, name }));

// PC agents authenticate with the device id + secret they received when
// they were linked; apps authenticate with a sign-in session token.
export const authMessageSchema = z.discriminatedUnion("role", [
  z.object({
    type: z.literal("auth"),
    role: z.literal("pc"),
    deviceId: z.string().min(1).max(100),
    secret: z.string().min(1).max(200),
    name: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal("auth"),
    role: z.literal("app"),
    sessionToken: z.string().min(1).max(300),
  }),
]);

export const reportLanDevicesMessageSchema = z.object({
  type: z.literal("report_lan_devices"),
  devices: z.array(lanDeviceSchema),
});

export const getDevicesMessageSchema = z.object({
  type: z.literal("get_devices"),
});

export const signalMessageSchema = z.object({
  type: z.literal("signal"),
  target: z.string().min(1),
  payload: z.unknown(),
});

export const pingMessageSchema = z.object({
  type: z.literal("ping"),
});

/** Every message a client may send once authenticated. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  reportLanDevicesMessageSchema,
  getDevicesMessageSchema,
  signalMessageSchema,
  pingMessageSchema,
]);

export type AuthMessage = z.infer<typeof authMessageSchema>;
export type ReportLanDevicesMessage = z.infer<typeof reportLanDevicesMessageSchema>;
export type GetDevicesMessage = z.infer<typeof getDevicesMessageSchema>;
export type SignalMessage = z.infer<typeof signalMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Outbound (server -> client). Plain TS types are enough here since we
// control what we send.
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "auth_ok"; deviceId: string; role: "pc" | "app" }
  | { type: "devices"; pcs: PcSummary[] }
  | { type: "signal"; from: string; payload: unknown }
  | { type: "pong" }
  | { type: "error"; message: string; target?: string };
