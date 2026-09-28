// One-time copy of accounts, sign-ins and linked PCs from the old JSON file
// (data/store.json) into PostgreSQL. Safe to run more than once: rows that
// already exist are skipped.
//   npm run import-json            (reads DATABASE_URL and DATA_FILE from .env)
import fs from "node:fs";
import { config } from "../config/env";
import { PgStore } from "../store/pgStore";
import type { StoreState } from "../store/store";

async function main() {
  if (!config.databaseUrl) throw new Error("Set DATABASE_URL in .env first.");
  if (!fs.existsSync(config.dataFile)) {
    console.log(`Nothing to import: ${config.dataFile} doesn't exist.`);
    return;
  }
  const state = JSON.parse(fs.readFileSync(config.dataFile, "utf8")) as Partial<StoreState>;
  if (state.version !== 2) {
    console.log("That file is from before accounts existed — nothing to import.");
    return;
  }

  const db = new PgStore(config.databaseUrl);
  await db.init();
  let users = 0, sessions = 0, pcs = 0;

  for (const user of Object.values(state.users ?? {})) if (await db.createUser(user)) users++;
  for (const s of Object.values(state.sessions ?? {})) {
    if (!(await db.getUser(s.userId)) || (await db.getSession(s.id))) continue;
    await db.createSession(s);
    sessions++;
  }
  for (const [id, pc] of Object.entries(state.pcs ?? {})) {
    if (!(await db.getUser(pc.ownerId)) || (await db.getPc(id))) continue;
    await db.createPc(id, pc);
    pcs++;
  }
  await db.close();
  console.log(`Imported ${users} user(s), ${sessions} sign-in(s), ${pcs} PC(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
