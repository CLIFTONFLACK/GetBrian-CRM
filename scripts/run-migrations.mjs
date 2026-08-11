// One-off runner: applies db/migrations/*.sql to DATABASE_URL in filename
// order, each file as one simple-protocol multi-statement query (Client,
// not the HTTP `neon()` tag, since only Client supports arbitrary
// multi-statement SQL text). Not part of the app — a maintainer script.
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
