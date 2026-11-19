// Maintainer script: runs the named .sql files, in the order given, against
// STORAGE_CRM_DATABASE_URL. Each file is one simple-protocol multi-statement
// query, the same as scripts/run-migrations.mjs, but only for the files named.
// Use it where psql is not installed.
//
//   node scripts/run-sql-file.mjs --env .env.local \
//     [--not-host-of <other env file>] [--expect-notice "<text>"] <file.sql> ...
//
// --env             File to read STORAGE_CRM_DATABASE_URL from (default .env.local).
// --not-host-of     Safety guard. Refuses to run when the target database host is
//                   the same as the host in this second env file. Point it at the
//                   env file of the live database when you work on a test branch.
// --expect-notice   Exit 1 unless the server sends a NOTICE that contains this
//                   text. scripts/verify-0044.sql needs it: its only proof of
//                   success is the NOTICE "verify-0044: all checks passed".
//
// The script prints the database host, never the user name or the password.
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";

const KEY = "STORAGE_CRM_DATABASE_URL";

function readUrl(envFile) {
  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== KEY) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0])
      value = value.slice(1, -1);
    return value;
  }
  return "";
}

/** The host with Neon's "-pooler" suffix removed, so pooled and direct compare equal. */
function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace("-pooler.", ".");
}

const args = process.argv.slice(2);
let envFile = ".env.local";
let guardFile = "";
let expectNotice = "";
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--env") envFile = args[++i];
  else if (args[i] === "--not-host-of") guardFile = args[++i];
  else if (args[i] === "--expect-notice") expectNotice = args[++i];
  else files.push(args[i]);
}
if (!files.length) {
  console.error("No .sql file was named.");
  process.exit(2);
}

const url = readUrl(envFile);
if (!url) {
  console.error(`${KEY} is not set in ${envFile}`);
  process.exit(2);
}
const host = hostOf(url);
console.log(`target host: ${host}`);

if (guardFile) {
  const guardUrl = readUrl(guardFile);
  if (!guardUrl) {
    console.error(`${KEY} is not set in ${guardFile}: the guard cannot compare, so nothing runs.`);
    process.exit(2);
  }
  if (hostOf(guardUrl) === host) {
    console.error(`REFUSED: the target host is the same as the host in ${guardFile}.`);
    process.exit(3);
  }
  console.log(`guard passed: the host differs from the host in ${guardFile}`);
}

const client = new Client(url);
const notices = [];
client.on("notice", (n) => {
  notices.push(String(n.message ?? ""));
  console.log(`NOTICE: ${n.message}`);
});
await client.connect();

let failed = false;
try {
  for (const file of files) {
    process.stdout.write(`running ${file} ... `);
    await client.query(readFileSync(file, "utf8"));
    console.log("ok");
  }
} catch (err) {
  failed = true;
  console.log("FAILED");
  console.error(err instanceof Error ? err.message : String(err));
} finally {
  await client.end();
}

if (failed) process.exit(1);
if (expectNotice && !notices.some((m) => m.includes(expectNotice))) {
  console.error(`FAILED: no NOTICE contained "${expectNotice}".`);
  process.exit(1);
}
console.log("done");
