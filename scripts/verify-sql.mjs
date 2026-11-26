// Runs a scripts/verify-*.sql file against DATABASE_URL without psql. The verify
// files use the psql meta-command `\i path` to include a migration; psql is not
// installed on every machine, so this inlines each `\i` line and sends the whole
// file as one simple-protocol query, the way scripts/apply-migration.mjs does.
//
//   node --env-file=.env.local scripts/verify-sql.mjs verify-0049.sql
//
// The verify file runs inside begin ... rollback, so nothing is kept, but it
// does take table locks for the length of the run and it runs the migration's
// DDL inside that transaction. Point it at a copy of the data when you can.
// Success is the NOTICE "verify-0049: all checks passed"; a failed check raises
// an exception and this script exits 1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@neondatabase/serverless";

const name = process.argv[2];
if (!name) {
  console.error("usage: node --env-file=.env.local scripts/verify-sql.mjs <verify-file.sql>");
  process.exit(1);
}

const url = process.env.STORAGE_CRM_DATABASE_URL;
if (!url) throw new Error("STORAGE_CRM_DATABASE_URL is not set");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "scripts", name);

const text = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = /^\\i\s+(\S+)\s*$/.exec(line);
    return m ? readFileSync(path.join(root, m[1]), "utf8") : line;
  })
  .join("\n");

const client = new Client(url);
const notices = [];
client.on("notice", (n) => notices.push(n.message));
await client.connect();
try {
  await client.query(text);
} catch (err) {
  // The rollback at the end of the file may not have run: undo whatever is open.
  try {
    await client.query("rollback");
  } catch {
    // Nothing open.
  }
  console.error(`${name} FAILED: ${err.message}`);
  await client.end();
  process.exit(1);
}
await client.end();
for (const n of notices) console.log(n);
if (!notices.some((n) => n.includes("all checks passed"))) {
  console.error(`${name}: no "all checks passed" notice, so it is not proven.`);
  process.exit(1);
}
