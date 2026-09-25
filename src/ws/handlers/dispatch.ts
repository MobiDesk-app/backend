import type { HandlerContext } from "../handlerContext";
import type { ClientMessage } from "../../types/messages";
import { handleReportLanDevices } from "./reportLanDevices";
import { handleGetDevices } from "./getDevices";
import { handleSignal } from "./signal";
import { handlePing } from "./ping";

/**
 * Routes an already-validated, already-authenticated message to its handler.
 * Adding a new message type means: add it to the zod union in
 * src/types/messages.ts, write a handler, add one line here.
 */
export function dispatch(ctx: HandlerContext, msg: ClientMessage): void {
  switch (msg.type) {
    case "report_lan_devices":
      return handleReportLanDevices(ctx, msg);
    case "get_devices":
      return handleGetDevices(ctx, msg);
    case "signal":
      return handleSignal(ctx, msg);
    case "ping":
      return handlePing(ctx, msg);
    default: {
      const exhaustive: never = msg;
      throw new Error(`Unhandled message type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
