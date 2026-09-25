// Quick manual check of the auth -> report -> query -> signal flow.
// Run: npm run smoke-test   (server must already be running)
import "dotenv/config";
import WebSocket from "ws";

const PORT = process.env.PORT ?? "8080";
const URL = `ws://localhost:${PORT}`;
const TOKEN = process.env.AUTH_TOKEN ?? "";

function connect(deviceId: string, role: "pc" | "app", name: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", token: TOKEN, deviceId, role, name }));
    });
    ws.once("message", (raw) => {
      console.log(`[${deviceId}] <-`, raw.toString());
      resolve(ws);
    });
  });
}

async function main() {
  const pc = await connect("pc-1", "pc", "Hazem-Desktop");
  const app = await connect("phone-1", "app", "Hazem-iPhone");

  pc.send(
    JSON.stringify({
      type: "report_lan_devices",
      devices: [
        { ip: "192.168.1.2", mac: "aa:bb:cc:00:11:22", name: "Living Room TV" },
        { ip: "192.168.1.3", mac: "aa:bb:cc:00:11:33", name: "iPhone" },
      ],
    })
  );

  await new Promise((r) => setTimeout(r, 300));

  app.on("message", (raw) => console.log("[phone-1] <-", raw.toString()));
  app.send(JSON.stringify({ type: "get_devices" }));

  await new Promise((r) => setTimeout(r, 300));

  pc.on("message", (raw) => console.log("[pc-1] <-", raw.toString()));
  app.send(
    JSON.stringify({
      type: "signal",
      target: "pc-1",
      payload: { kind: "offer", sdp: "..." },
    })
  );

  await new Promise((r) => setTimeout(r, 300));
  pc.close();
  app.close();
  process.exit(0);
}

main();
