import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Config } from "../config/env";
import type { Store } from "../store/store";
import type { SessionService } from "../auth/sessions";
import type { PairingService } from "../pairing/pairingService";
import type { ConnectionHub } from "../ws/connectionHub";
import { hashPassword, verifyPassword, burnPasswordCheck } from "../auth/password";
import { randomId } from "../auth/secrets";
import { RateLimiter } from "../auth/rateLimiter";
import type { SessionRecord, UserRecord } from "../types/device";

export interface AppDeps {
  config: Config;
  store: Store;
  sessions: SessionService;
  pairing: PairingService;
  hub: ConnectionHub;
}

const MIN = 60_000;
// Failed-attempt limits. Successful attempts don't count.
const loginPerEmail = new RateLimiter(8, 15 * MIN);
const loginPerIp = new RateLimiter(30, 15 * MIN);
const registerPerIp = new RateLimiter(10, 60 * MIN); // counts every signup, not only failures
const claimPerUser = new RateLimiter(5, 15 * MIN);
const claimPerIp = new RateLimiter(20, 15 * MIN);
const pairStartPerIp = new RateLimiter(20, 10 * MIN);

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  deviceName: z.string().max(64).optional(),
});

type AuthedRequest = Request & { auth: { user: UserRecord; session: SessionRecord } };

function tooMany(res: Response, ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / MIN));
  res.setHeader("Retry-After", String(Math.ceil(ms / 1000)));
  return res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
}

/**
 * Express 4 doesn't catch rejected promises from async handlers — an
 * unexpected database error would otherwise crash the whole process.
 */
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const safe =
  (fn: Handler): Handler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      console.error(`[http] ${req.method} ${req.path} failed:`, err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: "Something went wrong on the server. Please try again." });
    });

function publicUser(user: UserRecord) {
  return { id: user.id, email: user.email };
}

export function createApp({ config, store, sessions, pairing, hub }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", true);
  app.use(express.json({ limit: "16kb" }));

  // CORS: the web app is served from a different origin than this API.
  // Auth uses a bearer header, not cookies, so no credentials mode needed.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins === "*" || config.corsOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", config.corsOrigins === "*" ? "*" : origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  const requireAuth = safe(async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const auth = await sessions.verify(token);
    if (!auth) return void res.status(401).json({ error: "Please sign in again." });
    (req as AuthedRequest).auth = auth;
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ---------------------------------------------------------------- accounts
  app.post("/api/auth/register", safe(async (req, res) => {
    if (!config.allowRegistration) return void res.status(403).json({ error: "Sign-ups are closed on this server." });
    const ip = req.ip ?? "?";
    const wait = registerPerIp.blockedFor(ip);
    if (wait) return void tooMany(res, wait);

    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { email, password, deviceName } = parsed.data;
    registerPerIp.fail(ip);

    const exists = () => res.status(409).json({ error: "An account with this email already exists." });
    if (await store.findUserByEmail(email)) return void exists();

    const user: UserRecord = {
      id: randomId("usr"),
      email,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    if (!(await store.createUser(user))) return void exists();
    const token = await sessions.create(user.id, deviceName ?? "Browser");
    res.status(201).json({ token, user: publicUser(user) });
  }));

  app.post("/api/auth/login", safe(async (req, res) => {
    const ip = req.ip ?? "?";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName : "Browser";

    const wait = Math.max(loginPerEmail.blockedFor(email), loginPerIp.blockedFor(ip));
    if (wait) return void tooMany(res, wait);

    const user = email ? await store.findUserByEmail(email) : undefined;
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false);
    if (!user || !ok) {
      loginPerEmail.fail(email);
      loginPerIp.fail(ip);
      // Same message for "no such email" and "wrong password".
      return void res.status(401).json({ error: "Wrong email or password." });
    }

    loginPerEmail.reset(email);
    const token = await sessions.create(user.id, deviceName);
    res.json({ token, user: publicUser(user) });
  }));

  app.post("/api/auth/logout", requireAuth, safe(async (req, res) => {
    const { session } = (req as AuthedRequest).auth;
    await sessions.revoke(session.id);
    hub.closeWhere((c) => c.sessionId === session.id, 4003, "signed out");
    res.sendStatus(204);
  }));

  app.get("/api/auth/me", requireAuth, safe(async (req, res) => {
    res.json({ user: publicUser((req as AuthedRequest).auth.user) });
  }));

  // -------------------------------------------------------------------- PCs
  app.get("/api/pcs", requireAuth, safe(async (req, res) => {
    res.json({ pcs: await store.listPcsForUser((req as AuthedRequest).auth.user.id, hub.onlinePcIds()) });
  }));

  app.delete("/api/pcs/:id", requireAuth, safe(async (req, res) => {
    const pcId = String(req.params.id);
    const pc = await store.getPc(pcId);
    if (!pc || pc.ownerId !== (req as AuthedRequest).auth.user.id) return void res.status(404).json({ error: "PC not found." });
    await store.deletePc(pcId);
    // Kick the agent; its credential no longer exists, so it will go back
    // to showing a new link code.
    hub.closeWhere((c) => c.id === pcId, 4003, "unlinked");
    res.sendStatus(204);
  }));

  // ---------------------------------------------------------------- pairing
  // Called by the PC agent (no account needed — it has nothing yet).
  app.post("/api/pairing/start", safe(async (req, res) => {
    const ip = req.ip ?? "?";
    const wait = pairStartPerIp.blockedFor(ip);
    if (wait) return void tooMany(res, wait);
    pairStartPerIp.fail(ip);
    const name = typeof req.body?.name === "string" ? req.body.name : "My PC";
    res.json(pairing.start(name));
  }));

  app.post("/api/pairing/poll", safe(async (req, res) => {
    const { pairingId, pollSecret } = req.body ?? {};
    if (typeof pairingId !== "string" || typeof pollSecret !== "string") return void res.status(400).json({ error: "Invalid input" });
    res.json(pairing.poll(pairingId, pollSecret));
  }));

  // Called by the signed-in user with the code shown on the PC.
  app.post("/api/pairing/claim", requireAuth, safe(async (req, res) => {
    const { user } = (req as AuthedRequest).auth;
    const ip = req.ip ?? "?";
    const wait = Math.max(claimPerUser.blockedFor(user.id), claimPerIp.blockedFor(ip));
    if (wait) return void tooMany(res, wait);

    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const pc = await pairing.claim(user.id, code);
    if (!pc) {
      claimPerUser.fail(user.id);
      claimPerIp.fail(ip);
      return void res.status(400).json({ error: "That code is wrong or has expired. Check the code on your PC." });
    }
    claimPerUser.reset(user.id);
    res.json({ pc });
  }));

  return app;
}
