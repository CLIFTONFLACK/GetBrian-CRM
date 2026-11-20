// Applies ONE migration file to DATABASE_URL — the counterpart to
// run-migrations.mjs, which is build-from-empty only and dies on an
// already-migrated database (see the banner at the top of that file).
//
//   node --env-file=.env.local scripts/apply-migration.mjs 0042_didit_kyb.sql
//
// Only safe for migrations written idempotently (`add column if not exists`,
// `create table if not exists`, guarded enum creation) — that is everything
// from 0036 onward, and this refuses nothing, so check the file before running
// it against a live database. The whole file goes over as one simple-protocol
// multi-statement query, same as the full runner, which needs Client rather
// than the HTTP `neon()` tag.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@neondatabase/serverless";

const name = process.argv[2];
if (!name) {
  console.error("usage: node --env-file=.env.local scripts/apply-migration.mjs <file.sql>");
  process.exit(1);
}

const url = process.env.STORAGE_CRM_DATABASE_URL;
if (!url) throw new Error("STORAGE_CRM_DATABASE_URL is not set");

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations",
  name,
);
const sql = readFileSync(file, "utf8");

const client = new Client(url);
await client.connect();
process.stdout.write(`applying ${name} ... `);
await client.query(sql);
console.log("ok");
await client.end();
