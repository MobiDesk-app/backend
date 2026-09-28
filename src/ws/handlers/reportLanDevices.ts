import type { HandlerContext } from "../handlerContext";
import type { ReportLanDevicesMessage } from "../../types/messages";

export async function handleReportLanDevices(ctx: HandlerContext, msg: ReportLanDevicesMessage): Promise<void> {
  if (ctx.conn.role !== "pc") return; // only PC agents report LAN state
  await ctx.store.setLanDevices(ctx.conn.id, msg.devices);
}
