// One-off runner: applies db/migrations/*.sql to DATABASE_URL in filename
// order, each file as one simple-protocol multi-statement query (Client,
// not the HTTP `neon()` tag, since only Client supports arbitrary
// multi-statement SQL text). Not part of the app — a maintainer script.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS NOT RE-RUNNABLE. It is for building a database from empty.
// ─────────────────────────────────────────────────────────────────────────────
// There is no migrations/schema-version table, so this replays EVERY file from
// 0001 on every run. Twelve of them (0001, 0004, 0007, 0012, 0013, 0017, 0019,
// 0020, 0021, 0023, 0026, 0028) carry unguarded `create table` / `create type`
// / `create index`, so against an already-migrated database this dies on
// 0001_init.sql with "relation already exists" and never reaches the new files.
//
// To apply new migrations to a live database, run just those files — read the
// URL from .env.local's STORAGE_CRM_DATABASE_URL, then `client.query()` each
// chosen file in order. Migrations from 0036 onward are written idempotently
// (`if not exists`, `add column if not exists`, guarded enum creation), so
// re-applying one of those is safe; the older ones are not.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@neondatabase/serverless";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const url = process.env.STORAGE_CRM_DATABASE_URL;
if (!url) throw new Error("STORAGE_CRM_DATABASE_URL is not set");

const client = new Client(url);
await client.connect();

for (const file of files) {
  const sql = readFileSync(path.join(dir, file), "utf8");
  process.stdout.write(`applying ${file} ... `);
  await client.query(sql);
  console.log("ok");
}

await client.end();
console.log(`applied ${files.length} migrations`);
