import type { HandlerContext } from "../handlerContext";
import type { GetDevicesMessage } from "../../types/messages";

export async function handleGetDevices(ctx: HandlerContext, _msg: GetDevicesMessage): Promise<void> {
  if (ctx.conn.role !== "app") return;
  ctx.send({ type: "devices", pcs: await ctx.store.listPcsForUser(ctx.conn.userId, ctx.hub.onlinePcIds()) });
}
