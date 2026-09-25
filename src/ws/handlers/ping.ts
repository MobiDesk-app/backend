import type { HandlerContext } from "../handlerContext";
import type { PingMessage } from "../../types/messages";

export function handlePing(ctx: HandlerContext, _msg: PingMessage): void {
  ctx.send({ type: "pong" });
}
