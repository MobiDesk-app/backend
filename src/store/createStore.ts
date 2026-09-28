import type { Config } from "../config/env";
import type { Store } from "./store";
import { FileStore } from "./fileStore";
import { PgStore } from "./pgStore";

export function createStore(config: Config): Store {
  if (config.databaseUrl) {
    console.log("[store] using PostgreSQL");
    return new PgStore(config.databaseUrl);
  }
  console.log(`[store] DATABASE_URL not set — using local file ${config.dataFile}`);
  return new FileStore(config.dataFile);
}
