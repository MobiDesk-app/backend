import http from "node:http";
import { config } from "./config/env";
import { createApp } from "./http/app";
import { createSocketServer } from "./ws/socketServer";
import { createStore } from "./store/createStore";
import { SessionService } from "./auth/sessions";
import { PairingService } from "./pairing/pairingService";
import { ConnectionHub } from "./ws/connectionHub";

process.on("unhandledRejection", (err) => {
  console.error("[server] unhandled promise rejection:", err instanceof Error ? err.message : err);
});

async function main() {
  const store = createStore(config);
  await store.init(); // creates DB tables if needed; fails fast on a bad DATABASE_URL

  const sessions = new SessionService(store);
  const pairing = new PairingService(store);
  const hub = new ConnectionHub();

  const httpServer = http.createServer(createApp({ config, store, sessions, pairing, hub }));
  createSocketServer({ httpServer, hub, store, sessions });

  httpServer.listen(config.port, () => {
    console.log(`Server listening on :${config.port} (sign-ups ${config.allowRegistration ? "open" : "closed"})`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      httpServer.close();
      void store.close().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error("[server] failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
