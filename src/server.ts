import http from "node:http";
import path from "node:path";
import { config } from "./config/env";
import { createApp } from "./http/app";
import { createSocketServer } from "./ws/socketServer";
import { FileDeviceRegistry } from "./registry/fileDeviceRegistry";

const registry = new FileDeviceRegistry(path.join(__dirname, "..", "data", "devices.json"));

const httpServer = http.createServer(createApp());
createSocketServer({ httpServer, registry, authToken: config.authToken });

httpServer.listen(config.port, () => {
  console.log(`Signaling server listening on :${config.port}`);
});
