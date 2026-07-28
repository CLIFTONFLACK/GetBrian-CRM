/**
 * Derive the client-safe London area options from the curated source dataset.
 *
 * Run manually after editing `london-areas.json` (NOT part of `npm run build`):
 *   node scripts/build-london-areas.mjs
 *
 * Input:  src/lib/locations/data/london-areas.json        (server-only, with centroids)
 * Output: src/lib/locations/data/london-area-options.json (client-safe, names only)
 *
 * Same split as the UK locations dataset: centroids and postcode-district lists
 * stay server-side (they're only needed by the matcher), while the dropdown
 * needs nothing but the name, the borough and the fare zone.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src", "lib", "locations", "data");

const source = JSON.parse(readFileSync(join(dataDir, "london-areas.json"), "utf8"));

const seen = new Set();
for (const a of source.areas) {
  const key = a.name.toLowerCase();
  if (seen.has(key)) throw new Error(`Duplicate London area: ${a.name}`);
  seen.add(key);
  if (!source.zones.includes(a.zone)) {
    throw new Error(`${a.name}: zone ${a.zone} is not one of ${source.zones.join(", ")}`);
  }
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) {
    throw new Error(`${a.name}: missing centroid`);
  }
}

const areas = [...source.areas]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((a) => [a.name, a.borough, a.zone]);

writeFileSync(
  join(dataDir, "london-area-options.json"),
  JSON.stringify({ attribution: source.attribution, zones: source.zones, areas }),
);

const perZone = source.zones
  .map((z) => `${z}:${source.areas.filter((a) => a.zone === z).length}`)
  .join(" ");
console.log(`Wrote ${areas.length} London areas (per zone — ${perZone})`);
