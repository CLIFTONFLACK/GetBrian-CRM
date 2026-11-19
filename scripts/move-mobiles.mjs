// Maintainer script: contacts whose Phone holds a mobile number and whose Mobile
// is empty get that number moved to Mobile (Phone is then empty). The Kato
// export put mobiles in "Phone Number", and the importer before this change
// copied them as they stood.
//
//   node scripts/move-mobiles.mjs --env .env.local            # dry run (default)
//   node scripts/move-mobiles.mjs --env .env.local --apply    # write
//   ... [--agency <agency uuid>]                              # one agency only
//
// --env is required, with or without --apply: the script always reads the
// database, so it must be told which one. The URL comes from
// STORAGE_CRM_DATABASE_URL in that file. Prints the database host, never the
// user name or password. Prints COUNTS ONLY: no names, numbers or ids.
//
// What counts as a mobile is classifyUkNumber in src/lib/import-parse.ts (the
// one the importer uses). A contact with BOTH a mobile-class Phone and a
// Mobile value is left alone: nothing is overwritten.
//
// date_updated: the update trigger from 0044 treats the move as a data edit and
// would set date_updated to now(). The script reads each row's date_updated
// first and sets it back in a second, date-only UPDATE in the same transaction
// (0044 case 2: a date-only change). The first update does move updated_at (a
// data column changed); date_updated is not moved. Before COMMIT the script
// checks every moved row has its original date_updated and rolls back if one
// does not.
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";

import { classifyUkNumber } from "../src/lib/import-parse.ts";

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

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : "";
};
const envFile = flag("--env");
const agency = flag("--agency");
if (!envFile) {
  console.error("REFUSED: --env <file> is required (it names the database to read).");
  process.exit(2);
}
if (agency && !/^[0-9a-f-]{36}$/i.test(agency)) {
  console.error("REFUSED: --agency must be a UUID.");
  process.exit(2);
}
const url = readUrl(envFile);
if (!url) {
  console.error(`${KEY} is not set in ${envFile}`);
  process.exit(2);
}
console.log(`target host: ${new URL(url).hostname.toLowerCase()}`);
console.log(apply ? "mode: APPLY (writes)" : "mode: dry run (nothing is written)");

const client = new Client(url);
await client.connect();
let failed = false;
try {
  const { rows } = await client.query(
    `select id, phone, mobile, date_updated::text as date_updated
       from public.contacts
      where phone is not null and btrim(phone) <> ''
        and ($1::uuid is null or agency_id = $1::uuid)`,
    [agency || null],
  );

  const counts = { withPhone: rows.length, mobileClass: 0, mobileCellFull: 0, toMove: 0 };
  const moves = [];
  for (const r of rows) {
    if (classifyUkNumber(r.phone) !== "mobile") continue;
    counts.mobileClass++;
    if (r.mobile != null && r.mobile.trim() !== "") {
      counts.mobileCellFull++;
      continue;
    }
    counts.toMove++;
    moves.push(r);
  }
  console.log(`contacts with a phone number: ${counts.withPhone}`);
  console.log(`  phone is a mobile number: ${counts.mobileClass}`);
  console.log(`    mobile already filled (left alone): ${counts.mobileCellFull}`);
  console.log(`    mobile empty (would move): ${counts.toMove}`);

  if (!apply || moves.length === 0) {
    if (!apply) console.log("dry run: nothing written. Add --apply to write.");
  } else {
    await client.query("begin");
    try {
      const ids = moves.map((m) => m.id);
      const phones = moves.map((m) => m.phone);
      const dates = moves.map((m) => m.date_updated);
      const moved = await client.query(
        `update public.contacts c
            set mobile = c.phone, phone = null
           from unnest($1::uuid[], $2::text[]) as t(id, phone)
          where c.id = t.id
            and c.phone = t.phone
            and (c.mobile is null or btrim(c.mobile) = '')`,
        [ids, phones],
      );
      // Date-only update: the trigger keeps updated_at and takes our date_updated.
      await client.query(
        `update public.contacts c
            set date_updated = t.d
           from unnest($1::uuid[], $2::timestamptz[]) as t(id, d)
          where c.id = t.id`,
        [ids, dates],
      );
      const bad = await client.query(
        `select count(*)::int as n
           from public.contacts c
           join unnest($1::uuid[], $2::timestamptz[]) as t(id, d) on t.id = c.id
          where c.date_updated is distinct from t.d`,
        [ids, dates],
      );
      console.log(`moved: ${moved.rowCount}`);
      console.log(`moved rows whose date_updated differs from the original: ${bad.rows[0].n}`);
      if (bad.rows[0].n !== 0 || moved.rowCount !== moves.length) {
        throw new Error(
          `check failed (moved ${moved.rowCount} of ${moves.length}, ${bad.rows[0].n} dates differ): rolled back`,
        );
      }
      await client.query("commit");
      console.log("committed");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
} catch (err) {
  failed = true;
  console.error(err instanceof Error ? err.message : String(err));
} finally {
  await client.end();
}
if (failed) process.exit(1);
