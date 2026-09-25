import type { HandlerContext } from "../handlerContext";
import type { GetDevicesMessage } from "../../types/messages";

export function handleGetDevices(ctx: HandlerContext, _msg: GetDevicesMessage): void {
  if (ctx.role !== "app") return;
  ctx.send({ type: "devices", pcs: ctx.registry.listPcs(ctx.hub.onlinePcIds()) });
}
