// The location catalog the Kato scripts parse with: the app's own place lists
// and, for "within N miles of X", coordinates built from the same JSON the
// importer's gazetteer reads (src/lib/locations). Shared by
// scripts/kato-dry-run.mjs and scripts/reparse-kato-requirements.mjs so both
// parse exactly as the importer does.
//
// Order matters, as in src/lib/actions/import-data.ts catalogCoords(): towns and
// counties first, then postcode districts (and their prefixes, as
// districtCentroid does), London areas last.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocationCatalog, normName } from "../../src/lib/import-parse.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const uk = readJson("src/lib/locations/data/uk-location-options.json");
const london = readJson("src/lib/locations/data/london-area-options.json");
const ukFull = readJson("src/lib/locations/data/uk-locations.json");
const londonFull = readJson("src/lib/locations/data/london-areas.json");

const coords = {};
for (const t of ukFull.towns) coords[t.name] = [t.lat, t.lng];
for (const c of ukFull.counties) if (c.lat != null && c.lng != null) coords[c.name] = [c.lat, c.lng];
for (const d of ukFull.districts) coords[d.code] = [d.lat, d.lng];
const prefixes = new Set(
  ukFull.districts.map((d) => /^[A-Z]{1,2}\d/.exec(d.code)?.[0]).filter(Boolean),
);
for (const p of prefixes) {
  if (coords[p]) continue;
  const members = ukFull.districts.filter(
    (d) => d.code.startsWith(p) && /^[A-Z]$/.test(d.code.slice(p.length)),
  );
  if (members.length) {
    coords[p] = [
      members.reduce((a, d) => a + d.lat, 0) / members.length,
      members.reduce((a, d) => a + d.lng, 0) / members.length,
    ];
  }
}
for (const a of londonFull.areas) coords[a.name] = [a.lat, a.lng];

export const catalog = buildLocationCatalog({
  neighbourhoods: london.areas.map((a) => a[0]),
  towns: uk.towns,
  counties: uk.counties,
  regions: uk.regions,
  districts: uk.districts.map((d) => d[0]),
  coords,
});

// Words of every place name we know, plus plain function words. A token printed
// to the console may contain a capitalised word only if it is in this set:
// anything else could be a person's or a company's name, so it is counted, not shown.
const KNOWN_WORDS = new Set(
  [...london.areas.map((a) => a[0]), ...uk.towns, ...uk.counties, ...uk.regions]
    .flatMap((n) => normName(n).split(/[^a-z]+/))
    .filter(Boolean),
);
for (const w of "within miles mile of from zone zones and or the near around central greater london north south east west city".split(" ")) {
  KNOWN_WORDS.add(w);
}

export function tokenIsSafeToShow(token) {
  for (const word of token.split(/[^A-Za-z]+/)) {
    if (!word) continue;
    if (/^[A-Z]/.test(word) && !KNOWN_WORDS.has(word.toLowerCase())) return false;
  }
  return true;
}
