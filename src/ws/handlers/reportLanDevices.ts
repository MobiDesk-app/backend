import type { HandlerContext } from "../handlerContext";
import type { ReportLanDevicesMessage } from "../../types/messages";

export function handleReportLanDevices(ctx: HandlerContext, msg: ReportLanDevicesMessage): void {
  if (ctx.role !== "pc") return; // only PC agents report LAN state
  ctx.registry.setLanDevices(ctx.deviceId, msg.devices);
}
