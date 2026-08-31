/**
 * Turn a CDG search-alert "Area" cell into the CRM's Target Location fields.
 *
 * The column is free text from their old portal's alert builder, mixing four
 * different kinds of thing in one comma-separated cell:
 *
 *   "Zone 1, Zone 2"
 *   "Clapham/Balham/Tooting"
 *   "Within 3 miles of Fitzrovia W1, Fully Fitted Restaurant with Extract"
 *   "Within 3 miles of Lakeside Shopping Centre"
 *
 * The last kind is the interesting one: "within N miles of X" where X is one of
 * CDG's *own listings*. Resolving X against the listing book gives a real
 * postcode and town instead of a guess — and it is why listing resolution runs
 * FIRST and consumes the phrase. "Within 3 miles of Victoria Centre" would
 * otherwise word-match London's Victoria, when that listing is in Nottingham.
 *
 * Deliberately conservative about towns: a town is only accepted from a
 * resolved listing's own city, or from a whole token that is nothing but a town
 * name. Free-text town scanning would turn "22 London Road" into a London
 * target, and 1,448 UK town names include far too many ordinary words.
 */
import { containsWord } from "@/lib/text-match";
import {
  DISTRICT_OPTIONS,
  LONDON_AREA_OPTIONS,
  TOWN_OPTIONS,
  COUNTY_OPTIONS,
} from "@/lib/locations/options";
import { extractDistrict } from "@/lib/locations";

const AREA_BY_LOWER = new Map(LONDON_AREA_OPTIONS.map((a) => [a[0].toLowerCase(), a[0]]));
const TOWN_BY_LOWER = new Map(TOWN_OPTIONS.map((t) => [t.toLowerCase(), t]));
const COUNTY_BY_LOWER = new Map(COUNTY_OPTIONS.map((c) => [c.toLowerCase(), c]));
const DISTRICT_SET = new Set(DISTRICT_OPTIONS.map((d) => d[0].toUpperCase()));
const AREA_NAMES = LONDON_AREA_OPTIONS.map((a) => a[0]);

const RADIUS = /^\s*within\s+[\d.]+\s+miles?\s+of\s+/i;
const FLEX = /\(\s*\+\s*[\d.]+\s*miles?\s*\)/gi;

/** Every valid postcode district appearing as a standalone token. */
function districtsIn(text) {
  return [...text.toUpperCase().matchAll(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/g)]
    .map((m) => m[1])
    .filter((d) => DISTRICT_SET.has(d));
}

/** "Zone 1" … "Zone 9", however they were spelled. */
function zonesIn(text) {
  return [...text.matchAll(/\bzone\s*([1-9])\b/gi)].map((m) => `Zone ${m[1]}`);
}

/**
 * Split an Area cell into phrases. "Within N miles of" marks a phrase start, so
 * split there first — that keeps a multi-comma address ("Peek House, 20
 * Eastcheap, EC3M 1ED") inside one phrase instead of shredding it. Cells with
 * no radius phrase fall back to a plain comma split.
 */
export function splitAreaPhrases(cell) {
  const parts = cell
    .split(/(?=within\s+[\d.]+\s+miles?\s+of\s+)/i)
    .map((s) => s.trim().replace(/,\s*$/, ""))
    .filter(Boolean);
  if (parts.length > 1 || RADIUS.test(cell)) return parts;
  return cell.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param cell   the raw Area text
 * @param index  Map of lower-cased listing title -> {city, postcode, area}
 */
export function parseArea(cell, index = new Map()) {
  const out = {
    zones: new Set(),
    neighbourhoods: new Set(),
    towns: new Set(),
    counties: new Set(),
    districts: new Set(),
  };
  const leftover = [];
  if (!cell || !cell.trim()) return finish(out, leftover);

  for (const rawPhrase of splitAreaPhrases(cell)) {
    const phrase = rawPhrase.replace(FLEX, "").trim();
    if (!phrase) continue;

    const zones = zonesIn(phrase);
    if (zones.length) {
      zones.forEach((z) => out.zones.add(z));
      // A cell can be nothing but zones; if the phrase had more, keep going.
      if (/^(\s*zone\s*[1-9]\s*,?)+$/i.test(phrase)) continue;
    }

    const body = phrase.replace(RADIUS, "").trim().replace(/[.,]$/, "");
    if (!body) continue;

    // 1. Does this name one of CDG's own listings? Authoritative — take its
    //    real location and do NOT word-scan the phrase (Victoria Centre trap).
    const listing = index.get(body.toLowerCase());
    if (listing) {
      const district = listing.postcode ? extractDistrict(listing.postcode) : null;
      if (district && DISTRICT_SET.has(district.toUpperCase()))
        out.districts.add(district.toUpperCase());
      const city = (listing.city ?? "").trim();
      if (city) {
        if (AREA_BY_LOWER.has(city.toLowerCase()))
          out.neighbourhoods.add(AREA_BY_LOWER.get(city.toLowerCase()));
        else if (TOWN_BY_LOWER.has(city.toLowerCase()))
          out.towns.add(TOWN_BY_LOWER.get(city.toLowerCase()));
      }
      const listingArea = (listing.area ?? "").trim();
      if (listingArea && AREA_BY_LOWER.has(listingArea.toLowerCase()))
        out.neighbourhoods.add(AREA_BY_LOWER.get(listingArea.toLowerCase()));
      continue;
    }

    // 2. Exact whole-token matches — "Clapham/Balham/Tooting", "Surrey", "W1".
    let placed = false;
    for (const token of body.split("/").map((t) => t.trim()).filter(Boolean)) {
      const key = token.toLowerCase();
      if (AREA_BY_LOWER.has(key)) {
        out.neighbourhoods.add(AREA_BY_LOWER.get(key));
        placed = true;
      } else if (TOWN_BY_LOWER.has(key)) {
        out.towns.add(TOWN_BY_LOWER.get(key));
        placed = true;
      } else if (COUNTY_BY_LOWER.has(key)) {
        out.counties.add(COUNTY_BY_LOWER.get(key));
        placed = true;
      }
    }

    // 3. Scan the remaining free text for London neighbourhoods and districts.
    //    Whole-word only, via the app's own matcher, so "Camden High Street"
    //    finds Camden but "Ashford Road" does not find Ash.
    const found = AREA_NAMES.filter((n) => containsWord(body, n));
    found.forEach((n) => out.neighbourhoods.add(n));
    const districts = districtsIn(body);
    districts.forEach((d) => out.districts.add(d));

    if (!placed && !found.length && !districts.length && !zones.length) leftover.push(rawPhrase.trim());
  }
  return finish(out, leftover);
}

function finish(out, leftover) {
  return {
    zones: [...out.zones].sort(),
    neighbourhoods: [...out.neighbourhoods],
    towns: [...out.towns],
    counties: [...out.counties],
    districts: [...out.districts],
    leftover,
    get any() {
      return (
        this.zones.length +
          this.neighbourhoods.length +
          this.towns.length +
          this.counties.length +
          this.districts.length >
        0
      );
    },
  };
}
