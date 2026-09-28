// End-to-end check of accounts, PC linking, and signal routing, including
// the attack cases. Run against a server started with a throwaway DATA_FILE:
//   node scripts/e2e-test.mjs [http://localhost:8080]
import WebSocket from "ws";

const HTTP = process.argv[2] ?? "http://localhost:8080";
const WS = HTTP.replace(/^http/, "ws");
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token, method = body ? "POST" : "GET") {
  const res = await fetch(HTTP + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function openWs(authMsg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    const inbox = [];
    ws.on("message", (m) => inbox.push(JSON.parse(m.toString())));
    ws.on("open", () => ws.send(JSON.stringify(authMsg)));
    ws.on("close", (code) => { ws.closeCode = code; resolve({ ws, inbox, closed: code }); });
    ws.once("message", () => setTimeout(() => resolve({ ws, inbox, closed: null }), 50));
  });
}

const stamp = Date.now();
const alice = { email: `alice${stamp}@test.dev`, password: "correct horse battery" };
const bob = { email: `bob${stamp}@test.dev`, password: "another good password" };

// --- accounts
let r = await api("/api/auth/register", alice);
check("register alice", r.status === 201 && r.body.token);
const aliceToken = r.body.token;
r = await api("/api/auth/register", bob);
const bobToken = r.body.token;
check("register bob", r.status === 201);
check("duplicate email rejected", (await api("/api/auth/register", alice)).status === 409);
check("short password rejected", (await api("/api/auth/register", { email: `x${stamp}@t.dev`, password: "123" })).status === 400);
r = await api("/api/auth/login", alice);
check("login with correct password", r.status === 200 && r.body.token);
r = await api("/api/auth/login", { ...alice, password: "wrong" });
check("login with wrong password -> 401", r.status === 401, r.body?.error);
r = await api("/api/auth/login", { email: `nobody${stamp}@t.dev`, password: "whatever1" });
check("unknown email gives same message", r.status === 401 && r.body.error === "Wrong email or password.");
check("/me with token", (await api("/api/auth/me", null, aliceToken)).body?.user?.email === alice.email);
check("/me with forged token -> 401", (await api("/api/auth/me", null, aliceToken.slice(0, -3) + "abc")).status === 401);

// brute force lockout on bob
let lastStatus = 0;
for (let i = 0; i < 10; i++) lastStatus = (await api("/api/auth/login", { ...bob, password: `guess${i}xx` })).status;
check("password guessing gets locked out (429)", lastStatus === 429);
check("even the right password is refused while locked", (await api("/api/auth/login", bob)).status === 429);

// --- pairing
const start = (await api("/api/pairing/start", { name: "Test PC" })).body;
check("agent gets a 6-digit code", /^\d{6}$/.test(start.code), start.code);
check("poll before claim = pending", (await api("/api/pairing/poll", { pairingId: start.pairingId, pollSecret: start.pollSecret })).body.status === "pending");
check("poll with wrong poll secret reveals nothing", (await api("/api/pairing/poll", { pairingId: start.pairingId, pollSecret: "nope" })).body.status === "expired");
const wrongCode = start.code === "000000" ? "111111" : "000000";
check("claim with wrong code rejected", (await api("/api/pairing/claim", { code: wrongCode }, aliceToken)).status === 400);
check("claim without signing in rejected", (await api("/api/pairing/claim", { code: start.code })).status === 401);
r = await api("/api/pairing/claim", { code: `${start.code.slice(0, 3)} ${start.code.slice(3)}` }, aliceToken);
check("alice claims code (spaces allowed)", r.status === 200 && r.body.pc?.name === "Test PC");
check("code can't be claimed twice", (await api("/api/pairing/claim", { code: start.code }, bobToken)).status === 400);
const paired = (await api("/api/pairing/poll", { pairingId: start.pairingId, pollSecret: start.pollSecret })).body;
check("agent receives its credentials", paired.status === "paired" && paired.deviceSecret?.length > 30);
check("credentials handed out only once", (await api("/api/pairing/poll", { pairingId: start.pairingId, pollSecret: start.pollSecret })).body.status === "expired");

// claim-guess lockout
for (let i = 0; i < 6; i++) lastStatus = (await api("/api/pairing/claim", { code: String(100000 + i) }, bobToken)).status;
check("code guessing gets locked out (429)", lastStatus === 429);

// --- WebSocket auth
const badPc = await openWs({ type: "auth", role: "pc", deviceId: paired.deviceId, secret: "wrong" });
check("PC with wrong secret refused", badPc.closed === 4003);
const oldStyle = await openWs({ type: "auth", token: "anything", deviceId: "pc-1", role: "pc" });
check("old shared-token login refused", oldStyle.closed === 4002);
const pc = await openWs({ type: "auth", role: "pc", deviceId: paired.deviceId, secret: paired.deviceSecret, name: "Test PC" });
check("PC connects with its secret", pc.inbox[0]?.type === "auth_ok");
const aliceApp = await openWs({ type: "auth", role: "app", sessionToken: aliceToken });
check("alice's app connects", aliceApp.inbox[0]?.type === "auth_ok");
const aliceAppId = aliceApp.inbox[0].deviceId;
const bobApp = await openWs({ type: "auth", role: "app", sessionToken: bobToken });

aliceApp.ws.send(JSON.stringify({ type: "get_devices" }));
bobApp.ws.send(JSON.stringify({ type: "get_devices" }));
await wait(200);
const aliceList = aliceApp.inbox.find((m) => m.type === "devices");
const bobList = bobApp.inbox.find((m) => m.type === "devices");
check("alice sees her PC online", aliceList?.pcs.length === 1 && aliceList.pcs[0].online === true);
check("bob sees no PCs", bobList?.pcs.length === 0);
check("PC list leaks no secrets", !JSON.stringify(aliceList).includes("secret") && !JSON.stringify(aliceList).includes("owner"));

aliceApp.ws.send(JSON.stringify({ type: "signal", target: paired.deviceId, payload: { kind: "offer" } }));
bobApp.ws.send(JSON.stringify({ type: "signal", target: paired.deviceId, payload: { kind: "evil" } }));
await wait(200);
const pcSignals = pc.inbox.filter((m) => m.type === "signal");
check("PC receives alice's offer", pcSignals.some((m) => m.payload.kind === "offer" && m.from === aliceAppId));
check("PC never receives bob's signal", !pcSignals.some((m) => m.payload.kind === "evil"));
check("bob just sees 'target offline'", bobApp.inbox.some((m) => m.type === "error" && m.message === "target offline"));
pc.ws.send(JSON.stringify({ type: "signal", target: aliceAppId, payload: { kind: "answer" } }));
await wait(150);
check("PC's answer reaches alice", aliceApp.inbox.some((m) => m.type === "signal" && m.payload.kind === "answer"));

// --- sign out & unlink
check("logout", (await api("/api/auth/logout", {}, aliceToken)).status === 204);
await wait(150);
check("signing out closes that session's live connection", aliceApp.ws.closeCode === 4003);
check("old token no longer works", (await api("/api/auth/me", null, aliceToken)).status === 401);
const alice2 = (await api("/api/auth/login", alice)).body.token;
check("bob can't unlink alice's PC", (await api(`/api/pcs/${paired.deviceId}`, null, bobToken, "DELETE")).status === 404);
check("alice unlinks her PC", (await api(`/api/pcs/${paired.deviceId}`, null, alice2, "DELETE")).status === 204);
await wait(150);
check("unlinked PC is disconnected", pc.ws.closeCode === 4003);
const again = await openWs({ type: "auth", role: "pc", deviceId: paired.deviceId, secret: paired.deviceSecret });
check("unlinked PC can't reconnect", again.closed === 4003);

bobApp.ws.close();
console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
