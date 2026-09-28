import type { HandlerContext } from "../handlerContext";
import type { SignalMessage } from "../../types/messages";

/**
 * Relays a WebRTC offer/answer/ICE payload to its target, but only between
 * a PC and an app signed in to the same account that owns it. Anything else
 * gets the same "target offline" answer as a PC that really is offline, so
 * the relay can't be used to probe which ids exist.
 */
export function handleSignal(ctx: HandlerContext, msg: SignalMessage): void {
  const target = ctx.hub.get(msg.target);
  const allowed = !!target && target.role !== ctx.conn.role && target.userId === ctx.conn.userId;

  const delivered =
    allowed && ctx.hub.sendTo(msg.target, { type: "signal", from: ctx.conn.id, payload: msg.payload });
  if (!delivered) {
    ctx.send({ type: "error", message: "target offline", target: msg.target });
  }
}
