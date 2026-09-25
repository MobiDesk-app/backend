import type { HandlerContext } from "../handlerContext";
import type { SignalMessage } from "../../types/messages";

/** Relays a WebRTC offer/answer/ICE payload to its target, untouched. */
export function handleSignal(ctx: HandlerContext, msg: SignalMessage): void {
  const delivered = ctx.hub.sendTo(msg.target, {
    type: "signal",
    from: ctx.deviceId,
    payload: msg.payload,
  });
  if (!delivered) {
    ctx.send({ type: "error", message: "target offline", target: msg.target });
  }
}
