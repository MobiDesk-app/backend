import "dotenv/config";
import path from "node:path";

export interface Config {
  port: number;
  /** PostgreSQL connection string (e.g. Neon). When set, all data lives there. */
  databaseUrl: string | undefined;
  /** Fallback JSON file used only when databaseUrl isn't set (local dev). */
  dataFile: string;
  /** Set to false once your own account exists, to stop strangers signing up. */
  allowRegistration: boolean;
  /** Comma-separated list of web origins allowed to call the HTTP API, or "*". */
  corsOrigins: string[] | "*";
  /** Set when running behind a proxy/load balancer (Render, Fly, Railway, nginx) so rate limits see real client IPs. */
  trustProxy: boolean;
}

const origins = (process.env.CORS_ORIGINS ?? "*").trim();

export const config: Config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL || undefined,
  dataFile: process.env.DATA_FILE ?? path.join(__dirname, "..", "..", "data", "store.json"),
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? "true").toLowerCase() !== "false",
  corsOrigins: origins === "*" ? "*" : origins.split(",").map((o) => o.trim()).filter(Boolean),
  trustProxy: (process.env.TRUST_PROXY ?? "false").toLowerCase() === "true",
};
