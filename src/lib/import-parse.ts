// Pure parsing for the bulk importer: dates, notes, booleans, and the free-text
// columns other CRMs export (size, rent, area, tenant, company type).
//
// No database, no framework, no "@/" imports: the importer, the unit tests and
// scripts/kato-dry-run.mjs all load this file directly. Location lists are
// passed in (see buildLocationCatalog) because Node cannot import the app's
// JSON data files without an alias hook.
//
// The rule for every parser here: say what could not be read. A value that
// cannot be parsed is reported as such, never guessed at.

import { createHash } from "node:crypto";

/**
 * No cell longer than this reaches a parser. The importer keeps the first
 * MAX_CELL_CHARS characters in notes and warns; the parsers also refuse longer
 * input themselves, so a hostile 80,000-character cell can never cost more
 * than a length check.
 */
export const MAX_CELL_CHARS = 2000;

/** Split a cell at the cap. `over` means "do not parse; keep `text` in notes". */
export function capCell(raw: string | null | undefined): { text: string; over: boolean } {
  const s = raw ?? "";
  return s.length > MAX_CELL_CHARS
    ? { text: s.slice(0, MAX_CELL_CHARS), over: true }
    : { text: s, over: false };
}

/** True when an ISO instant is more than a day after `nowMs` (a source date from the future). */
export function isMoreThanADayAhead(iso: string, nowMs: number): boolean {
  return Date.parse(iso) > nowMs + 86_400_000;
}

/** Distinct union, stored values first, incoming appended in order. */
export function unionTags(
  stored: readonly string[] | null | undefined,
  incoming: readonly string[] | null | undefined,
): string[] {
  return [...new Set([...(stored ?? []), ...(incoming ?? [])])];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type SourceDate =
  | { kind: "empty" }
  | { kind: "ok"; iso: string }
  | { kind: "invalid" };

const LONDON = "Europe/London";

function validCalendar(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d
  );
}

/** Wall-clock parts of an instant in Europe/London, as a UTC-style millisecond count. */
function londonWallMs(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Treat a naive wall-clock time as Europe/London and return the UTC instant. */
export function londonWallToIso(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): string {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let instant = naive - (londonWallMs(naive) - naive);
  // One refinement pass settles the hour either side of a clock change.
  instant = naive - (londonWallMs(instant) - instant);
  return new Date(instant).toISOString();
}

function fromParts(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  offsetMinutes: number | null,
): SourceDate {
  if (!validCalendar(y, mo, d) || h > 23 || mi > 59 || s > 59) return { kind: "invalid" };
  if (y < 1900 || y > 2100) return { kind: "invalid" };
  const iso =
    offsetMinutes === null
      ? londonWallToIso(y, mo, d, h, mi, s)
      : new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000).toISOString();
  return { kind: "ok", iso };
}

const TIME_PART = "(?:[T\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?\\s*(Z|[+-]\\d{2}:?\\d{2})?)?";
const ISO_RE = new RegExp("^(\\d{4})-(\\d{1,2})-(\\d{1,2})" + TIME_PART + "$", "i");
const UK_RE = new RegExp("^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})" + TIME_PART + "$", "i");
const SERIAL_RE = /^\d{5}(?:\.\d+)?$/;

function offsetOf(tz: string | undefined): number | null {
  if (!tz) return null;
  if (/^z$/i.test(tz)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Read a "last updated" cell. Accepts ISO (yyyy-mm-dd, optional time and
 * offset), UK day-first (dd/mm/yyyy, optional time) and Excel serial numbers.
 * A time with no offset is Europe/London wall-clock time. Day-first is the only
 * reading of a slashed date: 01/02/2026 is 1 February, and 02/13/2026 is
 * invalid rather than being read the American way.
 */
export function parseSourceDate(raw: string | null | undefined): SourceDate {
  if ((raw ?? "").length > MAX_CELL_CHARS) return { kind: "invalid" };
  const s = (raw ?? "").trim();
  if (!s) return { kind: "empty" };

  const iso = ISO_RE.exec(s);
  if (iso) {
    return fromParts(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0),
      offsetOf(iso[7]),
    );
  }
  const uk = UK_RE.exec(s);
  if (uk) {
    return fromParts(
      Number(uk[3]),
      Number(uk[2]),
      Number(uk[1]),
      Number(uk[4] ?? 0),
      Number(uk[5] ?? 0),
      Number(uk[6] ?? 0),
      offsetOf(uk[7]),
    );
  }
  if (SERIAL_RE.test(s)) {
    const serial = Number(s);
    if (serial < 20000 || serial > 80000) return { kind: "invalid" };
    // Excel's day 0 is 1899-12-30 (it counts a non-existent 29 Feb 1900).
    const totalSeconds = Math.round(serial * 86400);
    const wall = new Date(Date.UTC(1899, 11, 30) + totalSeconds * 1000);
    return fromParts(
      wall.getUTCFullYear(),
      wall.getUTCMonth() + 1,
      wall.getUTCDate(),
      wall.getUTCHours(),
      wall.getUTCMinutes(),
      wall.getUTCSeconds(),
      null,
    );
  }
  return { kind: "invalid" };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Combine stored notes with notes from an import. Incoming text never
 * overwrites. Notes are compared line by line (trimmed, case-sensitive): empty
 * stored notes take the incoming text; otherwise only incoming lines that are
 * not already a whole stored line are appended, as a new paragraph, with
 * their own blank-line breaks kept. There is no substring test: a stored
 * "Rent (as exported): Up to 50" does not hide an incoming "Rent (as exported):
 * Up to 500". Returns the text to store; equal to the stored text when nothing
 * is added, so a re-upload of the same file is a no-op.
 */
export function mergeNotes(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string {
  const stored = existing ?? "";
  const add = (incoming ?? "").trim();
  if (!add) return stored;
  if (!stored.trim()) return add;
  const have = new Set(stored.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of add.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      // A blank line is only a separator: never first, never doubled.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (have.has(line) || seen.has(line)) continue;
    seen.add(line);
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  if (kept.length === 0) return stored;
  return `${stored.trimEnd()}\n\n${kept.join("\n")}`;
}

/** Join non-empty note lines, one per line. */
export function joinNoteLines(...lines: (string | null | undefined)[]): string | null {
  const out = lines.map((l) => (l ?? "").trim()).filter(Boolean);
  return out.length ? out.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Booleans
// ---------------------------------------------------------------------------

/** Yes/No/true/false/1/0/Y/N. null = blank, "invalid" = something else. */
export function parseBool(raw: string | null | undefined): boolean | null | "invalid" {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "1", "t"].includes(s)) return true;
  if (["no", "n", "false", "0", "f"].includes(s)) return false;
  return "invalid";
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

export const SQM_TO_SQFT = 10.7639;

export type SizeKind = "empty" | "range" | "upto" | "from" | "single" | "unparsed";

export type ParsedSize = {
  kind: SizeKind;
  minSqft: number | null;
  maxSqft: number | null;
  /** The range was written high-to-low and has been put the right way round. */
  swapped: boolean;
  /** True when the original text should be kept in notes. */
  keepText: boolean;
  /** Digits replaced by 9, for reporting shapes without data. */
  shape: string;
};

const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?";
const SIZE_RANGE = new RegExp(`^${NUM}\\s*(?:to|-)\\s*${NUM}$`);
const SIZE_UPTO = new RegExp(`^(?:up\\s*to|max(?:imum)?)\\s+${NUM}$`);
const SIZE_FROM = new RegExp(`^(?:from|min(?:imum)?)\\s+${NUM}$`);
const SIZE_ONE = new RegExp(`^${NUM}$`);

const toNumber = (whole: string, frac?: string) =>
  Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);

const digitsToNine = (s: string) => s.replace(/\d/g, "9");

/** "1,000 to 4,000 sq ft", "Up to 2,000 sq ft", "From 3,000 sq ft", "175 to 275 sq m". */
export function parseSize(cell: string | null | undefined): ParsedSize {
  const none: ParsedSize = {
    kind: "empty",
    minSqft: null,
    maxSqft: null,
    swapped: false,
    keepText: false,
    shape: "",
  };
  if ((cell ?? "").length > MAX_CELL_CHARS) return { ...none, kind: "unparsed", keepText: true };
  const raw = (cell ?? "").trim();
  if (!raw) return none;
  const shape = digitsToNine(raw);
  const bad: ParsedSize = { ...none, kind: "unparsed", keepText: true, shape };

  const text = raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const unit = /\s*(sq\.?\s*ft\.?|sqft|sq\.?\s*feet|sq\.?\s*m(?:etres?|eters?)?\.?|sqm|m2|m²)$/.exec(text);
  if (!unit) return bad;
  const isMetric = /^(sq\.?\s*m|sqm|m2|m²)/.test(unit[1]) && !/^sq\.?\s*f/.test(unit[1]);
  const factor = isMetric ? SQM_TO_SQFT : 1;
  const body = text.slice(0, unit.index).trim();
  const conv = (n: number) => Math.round(n * factor);

  let m = SIZE_RANGE.exec(body);
  if (m) {
    let lo = toNumber(m[1], m[2]);
    let hi = toNumber(m[3], m[4]);
    if (lo <= 0 || hi <= 0) return bad;
    const swapped = lo > hi;
    if (swapped) [lo, hi] = [hi, lo];
    return { kind: "range", minSqft: conv(lo), maxSqft: conv(hi), swapped, keepText: false, shape };
  }
  m = SIZE_UPTO.exec(body);
  if (m) {
    const n = toNumber(m[1], m[2]);
    if (n <= 0) return bad;
    return { kind: "upto", minSqft: null, maxSqft: conv(n), swapped: false, keepText: false, shape };
  }
  m = SIZE_FROM.exec(body);
  if (m) {
    const n = toNumber(m[1], m[2]);
    if (n <= 0) return bad;
    return { kind: "from", minSqft: conv(n), maxSqft: null, swapped: false, keepText: false, shape };
  }
  m = SIZE_ONE.exec(body);
  if (m) {
    const n = toNumber(m[1], m[2]);
    if (n <= 0) return bad;
    // A single figure is ambiguous (target? ceiling?). It goes in as a ceiling
    // and the text stays in notes so nobody mistakes it for a range.
    return { kind: "single", minSqft: null, maxSqft: conv(n), swapped: false, keepText: true, shape };
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Rent
// ---------------------------------------------------------------------------

export type RentOutcome =
  | "empty"
  | "converted"
  | "plain_number"
  | "floor"
  | "per_sqft"
  | "per_month"
  | "other_unit"
  | "no_unit"
  | "unparsed";

export type ParsedRent = {
  outcome: RentOutcome;
  maxRent: number | null;
  /** "Rent (as exported): ..." when the figure was not converted. */
  note: string | null;
  shape: string;
};

// Bounded and anchored on the left: a digit run can only be entered at its
// start (the lookbehind), and each branch is capped, so an 80,000-digit cell
// costs one failed attempt per position instead of re-scanning the whole run.
const AMOUNT_RE =
  /(?<![\d,.])(?:£\s*)?(\d{1,3}(?:,\d{3}){1,6}|\d{1,15})(\.\d{1,4})?(k|m)?(?![a-z0-9])/g;
const PLAIN_NUMBER_RE = /^£?\s*(\d{1,3}(?:[, ]\d{3}){1,6}|\d{1,15})(\.\d{1,4})?$/;
const FLOOR_RE = /\b(min|minimum|over|above|at least|from)\b|\d\+/;

function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    let n = Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`);
    if (m[3] === "k") n *= 1_000;
    if (m[3] === "m") n *= 1_000_000;
    out.push(Math.round(n * 100) / 100);
  }
  return out;
}

/**
 * Only annual rents become max_rent: "Up to £100,000 per annum" -> 100000 and
 * "£50,000 - £100,000 per annum" -> 100000 (the ceiling of the band). A cell
 * that is ONLY a number ("100000", "£100,000") sets max_rent and is read as an
 * annual figure, as an explicit max_rent column always was. A floor ("From",
 * "min", "over", "at least", a trailing "+") has no ceiling. Per sq ft, per
 * month and TEXT with no unit ("Up to £50,000") are NOT converted: a
 * per-sq-ft figure stored as a yearly budget would make the requirement match
 * almost nothing, and text with no unit could mean either.
 */
export function parseRent(cell: string | null | undefined): ParsedRent {
  if ((cell ?? "").length > MAX_CELL_CHARS) {
    return { outcome: "unparsed", maxRent: null, note: null, shape: "" };
  }
  const raw = (cell ?? "").trim();
  const shape = digitsToNine(raw);
  if (!raw) return { outcome: "empty", maxRent: null, note: null, shape };
  const note = `Rent (as exported): ${raw}`;
  const keep = (outcome: RentOutcome): ParsedRent => ({ outcome, maxRent: null, note, shape });
  const text = raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");

  // A cell that is only a number is a plain figure, as an explicit max_rent
  // column always was: digits, commas or spaces, optional £ and decimals.
  const plain = PLAIN_NUMBER_RE.exec(text);
  if (plain) {
    const n = Number(`${plain[1].replace(/[, ]/g, "")}${plain[2] ?? ""}`);
    return n > 0
      ? { outcome: "plain_number", maxRent: n, note: null, shape }
      : keep("unparsed");
  }
  if (/[$€]/.test(text)) return keep("unparsed");
  if (/(per|\/|a)\s*sq\.?\s*(ft|foot|feet)|\bpsf\b|per square f/.test(text)) return keep("per_sqft");
  if (/\bper\s*(month|mth)\b|\bpcm\b|\bp\.c\.m\b|\bmonthly\b/.test(text)) return keep("per_month");
  // "From", "min", "over", "at least" and a trailing "+" all describe a floor,
  // not a ceiling: there is no max_rent to set, so the text stays in notes.
  if (FLOOR_RE.test(text)) return keep("floor");
  const annual = /\bper\s*(annum|year|yr)\b|\bp\.?a\.?(?![a-z])|\bannually\b|\/\s*(annum|year)|\ba year\b/.test(text);
  if (!annual) return /\bper\s+[a-z]/.test(text) ? keep("other_unit") : keep("no_unit");

  const amounts = amountsIn(text).filter((n) => n > 0);
  if (amounts.length === 0 || amounts.length > 2) return keep("unparsed");
  return { outcome: "converted", maxRent: Math.max(...amounts), note: null, shape };
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export type LocationCatalogInput = {
  neighbourhoods: readonly string[];
  towns: readonly string[];
  counties: readonly string[];
  regions: readonly string[];
  districts: readonly string[];
};

export type LocationCatalog = {
  neighbourhood: Map<string, string>;
  town: Map<string, string>;
  county: Map<string, string>;
  region: Map<string, string>;
  districts: Set<string>;
};

/** Lower-case, drop apostrophes, collapse spaces: "Kings Cross" finds "King's Cross". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildLocationCatalog(input: LocationCatalogInput): LocationCatalog {
  const index = (names: readonly string[]) => new Map(names.map((n) => [normName(n), n]));
  return {
    neighbourhood: index(input.neighbourhoods),
    town: index(input.towns),
    county: index(input.counties),
    region: index(input.regions),
    districts: new Set(input.districts.map((d) => d.toUpperCase())),
  };
}

export type AreaKind = "zone" | "neighbourhood" | "town" | "county" | "region" | "district";

export type ParsedArea = {
  zones: string[];
  neighbourhoods: string[];
  towns: string[];
  counties: string[];
  regions: string[];
  districts: string[];
  /** Tokens (or parts) placed, by kind. */
  placed: Record<AreaKind, number>;
  /** Tokens nothing in them could be placed from. */
  unplaced: string[];
  /** Tokens placed in part: the original text is also kept in notes. */
  partial: string[];
  /** "Area (as exported): ..." when anything was not fully placed. */
  note: string | null;
};

const DISTRICT_SHAPE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const DISTRICT_RANGE = /^([A-Z]{1,2})(\d{1,2})\s*-\s*(?:\1)?(\d{1,2})$/;
const RADIUS = /^within\s+[\d.]+\s+miles?\s+of\b/i;
const FLEX = /\s*\(\s*\+\s*[\d.]+\s*miles?\s*\)\s*$/i;
const MAX_RANGE = 20;

/** W1 is not a district in the data (W1D, W1F...), but it is a real way to say it. */
function districtKnown(code: string, catalog: LocationCatalog): boolean {
  if (catalog.districts.has(code)) return true;
  for (const d of catalog.districts) {
    if (d.length > code.length && d.startsWith(code) && /[A-Z]/.test(d[code.length])) return true;
  }
  return false;
}

type Hit = { kind: AreaKind; value: string };

/** Place one whole name (no slash splitting). Several hits only for ranges. */
function placeName(name: string, catalog: LocationCatalog): Hit[] | null {
  const key = normName(name);
  const zone = /^zones?\s*([1-9])$/.exec(key);
  if (zone) return [{ kind: "zone", value: `Zone ${zone[1]}` }];
  const zoneRange = /^zones?\s*([1-9])\s*-\s*([1-9])$/.exec(key);
  if (zoneRange) {
    const a = Math.min(Number(zoneRange[1]), Number(zoneRange[2]));
    const b = Math.max(Number(zoneRange[1]), Number(zoneRange[2]));
    return Array.from({ length: b - a + 1 }, (_, i) => ({
      kind: "zone" as const,
      value: `Zone ${a + i}`,
    }));
  }
  const area = catalog.neighbourhood.get(key);
  if (area) return [{ kind: "neighbourhood", value: area }];
  const town = catalog.town.get(key);
  if (town) return [{ kind: "town", value: town }];
  const county = catalog.county.get(key);
  if (county) return [{ kind: "county", value: county }];
  const region = catalog.region.get(key);
  if (region) return [{ kind: "region", value: region }];

  const upper = name.trim().toUpperCase().replace(/\s+/g, "");
  if (DISTRICT_SHAPE.test(upper) && districtKnown(upper, catalog)) {
    return [{ kind: "district", value: upper }];
  }
  const range = DISTRICT_RANGE.exec(upper);
  if (range) {
    const a = Math.min(Number(range[2]), Number(range[3]));
    const b = Math.max(Number(range[2]), Number(range[3]));
    if (b - a + 1 > MAX_RANGE) return null;
    const hits: Hit[] = [];
    for (let n = a; n <= b; n++) {
      const code = `${range[1]}${n}`;
      if (districtKnown(code, catalog)) hits.push({ kind: "district", value: code });
    }
    // A range with an unknown district in it is not placed at all: its text
    // goes to notes rather than quietly shrinking to the part that matched.
    return hits.length === b - a + 1 ? hits : null;
  }
  return null;
}

/**
 * Turn a comma-separated Area cell into the requirement's target columns.
 * Anything that could not be placed is returned in `note`, verbatim, so no part
 * of the cell is ever lost. Whole names are matched before slash groups
 * ("Kensington/Notting Hill" is tried as one name, then as its parts).
 */
export function parseArea(cell: string | null | undefined, catalog: LocationCatalog): ParsedArea {
  const out: ParsedArea = {
    zones: [],
    neighbourhoods: [],
    towns: [],
    counties: [],
    regions: [],
    districts: [],
    placed: { zone: 0, neighbourhood: 0, town: 0, county: 0, region: 0, district: 0 },
    unplaced: [],
    partial: [],
    note: null,
  };
  if ((cell ?? "").length > MAX_CELL_CHARS) {
    const kept = (cell ?? "").slice(0, MAX_CELL_CHARS).trim();
    out.unplaced.push(kept);
    out.note = `Area (as exported): ${kept}`;
    return out;
  }
  const raw = (cell ?? "").trim();
  if (!raw) return out;

  const add = (hit: Hit) => {
    const list =
      hit.kind === "zone" ? out.zones
      : hit.kind === "neighbourhood" ? out.neighbourhoods
      : hit.kind === "town" ? out.towns
      : hit.kind === "county" ? out.counties
      : hit.kind === "region" ? out.regions
      : out.districts;
    if (!list.includes(hit.value)) list.push(hit.value);
    out.placed[hit.kind]++;
  };

  const noteTokens: string[] = [];
  for (const rawToken of raw.split(",")) {
    const original = rawToken.replace(/\s+/g, " ").trim();
    if (!original) continue;
    if (RADIUS.test(original)) {
      out.unplaced.push(original);
      noteTokens.push(original);
      continue;
    }
    const flexed = FLEX.test(original);
    const token = original.replace(FLEX, "").replace(/\.$/, "").trim();
    if (!token) continue;
    let hits: Hit[] = [];
    let complete = true;

    const london = /^london\s*[-–]\s*(.+)$/i.exec(token);
    const londonDistrict = /^london\s+([A-Za-z]{1,2}\d[A-Za-z\d]?)$/i.exec(token);
    const whole = london || londonDistrict ? null : placeName(token, catalog);
    if (london) {
      hits = [{ kind: "region", value: catalog.region.get("london") ?? "London" }];
      // "London - Greater London" says nothing more than London; "London -
      // Central" is narrower than the region, so keep its text too.
      complete = normName(london[1]) === "greater london";
    } else if (londonDistrict) {
      hits = placeName(londonDistrict[1], catalog) ?? [];
      complete = hits.length > 0;
    } else if (whole) {
      hits = whole;
    } else if (token.includes("/")) {
      const parts = token.split("/").map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const h = placeName(part, catalog);
        if (h) hits.push(...h);
        else complete = false;
      }
    } else {
      complete = false;
    }

    hits.forEach(add);
    if (hits.length === 0) {
      out.unplaced.push(original);
      noteTokens.push(original);
    } else if (!complete || flexed) {
      out.partial.push(original);
      noteTokens.push(original);
    }
  }
  out.note = noteTokens.length ? `Area (as exported): ${noteTokens.join(", ")}` : null;
  return out;
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export type ParsedTenant = {
  shape: "bracket" | "plain" | "unknown" | "empty";
  /** The part before the bracket, or the whole text for a plain tenant. */
  companyName: string | null;
  /** The bracketed part: "Mr First Last". */
  person: string | null;
};

/** "Company name (Mr First Last)" -> company before the bracket. */
export function parseTenant(raw: string | null | undefined): ParsedTenant {
  // Over the cap the cell is not parsed: it stays a plain tenant with no company.
  if ((raw ?? "").length > MAX_CELL_CHARS) return { shape: "plain", companyName: null, person: null };
  const s = (raw ?? "").trim();
  if (!s) return { shape: "empty", companyName: null, person: null };
  if (s.toLowerCase() === "unknown") return { shape: "unknown", companyName: null, person: null };
  // The last bracket pair, found by position (no regex, so nothing to backtrack).
  if (s.endsWith(")")) {
    const open = s.lastIndexOf("(");
    const inner = open >= 0 ? s.slice(open + 1, -1) : "";
    const company = open > 0 ? s.slice(0, open).trim() : "";
    if (open > 0 && company && !inner.includes(")")) {
      return { shape: "bracket", companyName: company, person: inner.trim() || null };
    }
  }
  return { shape: "plain", companyName: s, person: null };
}

// ---------------------------------------------------------------------------
// Stable reference for exports with no id column
// ---------------------------------------------------------------------------

/** Trim, lower-case, collapse spaces; drop a currency sign and digit-group
 *  commas inside numbers, so "£100,000" and "100000" read the same. */
const normaliseCell = (v: string | null | undefined) =>
  (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/£ ?(?=\d)/g, "")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");

/** The six cells a Kato requirements export has, as exported. A column the
 *  file lacks is an empty string: the slot is always there. */
export type LegacyRowCells = {
  title: string;
  size: string;
  propertyType: string;
  rent: string;
  area: string;
  email: string;
};

/**
 * "kato-" + the first 16 hex characters of a SHA-256 over the six cells in
 * fixed order, each normalised (trimmed, lower-cased, spaces collapsed,
 * currency signs and digit-group commas removed from numbers) and pipe-joined.
 * The shape never depends on which columns the file happens to have. Stable
 * across whitespace and case, so a second upload of the same file finds the
 * same rows and exact duplicate rows get the same reference (and collapse).
 */
export function legacyRowRef(c: LegacyRowCells): string {
  const cells = [c.title, c.size, c.propertyType, c.rent, c.area, c.email];
  const digest = createHash("sha256").update(cells.map(normaliseCell).join("|")).digest("hex");
  return `kato-${digest.slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Matching a changed row to the requirement it came from
// ---------------------------------------------------------------------------

export type ExistingRequirement = {
  id: string;
  title: string;
  contactId: string | null;
  companyId: string | null;
  /** The stored reference. Only null or "kato-..." ones can be adopted. */
  externalRef: string | null;
};

export type FileRequirement = {
  title: string;
  contactId: string | null;
  companyId: string | null;
  /** Set when the row's reference already matched a stored requirement. */
  existingId: string | null;
};

const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/** Title plus contact; with no contact, title plus company; else no key. */
function identityKey(title: string, contactId: string | null, companyId: string | null): string | null {
  const t = normTitle(title);
  if (!t) return null;
  if (contactId) return `${t}|c:${contactId}`;
  if (companyId) return `${t}|co:${companyId}`;
  return null;
}

/**
 * For file rows whose reference matched nothing: find the stored requirement
 * each one most likely IS, for rows imported before references existed or
 * edited in the source system. A row is "adopted" only when exactly one stored
 * requirement (not already matched by reference) has its title and contact (or
 * company) AND exactly one row in the file has that identity. Anything with
 * more than one candidate on either side is "ambiguous": the caller inserts
 * it as new and warns, because guessing would overwrite the wrong record.
 */
export function planAdoptions(
  existing: readonly ExistingRequirement[],
  file: readonly FileRequirement[],
): { adopt: Map<number, string>; ambiguous: Set<number> } {
  const claimed = new Set(file.map((f) => f.existingId).filter((x): x is string => !!x));
  const stored = new Map<string, string[]>();
  for (const e of existing) {
    if (claimed.has(e.id)) continue;
    // A reference somebody set on purpose ("REQ-1042") is never overwritten.
    if (e.externalRef && !e.externalRef.toLowerCase().startsWith("kato-")) continue;
    for (const k of [identityKey(e.title, e.contactId, null), identityKey(e.title, null, e.companyId)]) {
      if (!k) continue;
      const list = stored.get(k) ?? [];
      list.push(e.id);
      stored.set(k, list);
    }
  }
  const inFile = new Map<string, number>();
  const keys = file.map((f) => identityKey(f.title, f.contactId, f.companyId));
  for (const k of keys) if (k) inFile.set(k, (inFile.get(k) ?? 0) + 1);

  const adopt = new Map<number, string>();
  const ambiguous = new Set<number>();
  file.forEach((f, i) => {
    const k = keys[i];
    if (f.existingId || !k) return;
    const candidates = stored.get(k) ?? [];
    if (candidates.length === 0) return;
    if (candidates.length === 1 && inFile.get(k) === 1) adopt.set(i, candidates[0]);
    else ambiguous.add(i);
  });
  // One stored requirement is indexed under its contact key and its company
  // key, so two different file rows can each pick it. Neither may have it.
  const takers = new Map<string, number[]>();
  for (const [i, id] of adopt) takers.set(id, [...(takers.get(id) ?? []), i]);
  for (const rows of takers.values()) {
    if (rows.length < 2) continue;
    for (const i of rows) {
      adopt.delete(i);
      ambiguous.add(i);
    }
  }
  return { adopt, ambiguous };
}

// ---------------------------------------------------------------------------
// Company type
// ---------------------------------------------------------------------------

export type ParsedCompanyType = {
  /** Slug of the first value that matched a company type, else null. */
  type: string | null;
  /** Every other value, as written, for sector_tags. */
  extraTags: string[];
  /** Values that matched nothing (they are also in extraTags). */
  unmatched: string[];
};

/** "Applicant, Investor (Institutional)": match each value by slug or label. */
export function parseCompanyType(
  values: readonly string[],
  types: readonly { slug: string; label: string }[],
): ParsedCompanyType {
  const bySlugOrLabel = new Map<string, string>();
  for (const t of types) {
    bySlugOrLabel.set(t.slug.toLowerCase(), t.slug);
    bySlugOrLabel.set(t.label.trim().toLowerCase(), t.slug);
  }
  let type: string | null = null;
  const extraTags: string[] = [];
  const unmatched: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (!v) continue;
    const slug = bySlugOrLabel.get(v.toLowerCase());
    if (slug && type === null) type = slug;
    else {
      if (!slug) unmatched.push(v);
      if (!extraTags.includes(v)) extraTags.push(v);
    }
  }
  return { type, extraTags, unmatched };
}

/** A name needs at least one letter or digit: "-", "." and "..." are placeholders. */
export function hasLetterOrDigit(name: string): boolean {
  return /[\p{L}\p{N}]/u.test(name);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Group "Row 12: reason" lines by reason (quoted values are blanked out, so
 * the same fault on different rows counts as one) and show the biggest groups
 * with a count and up to three example row numbers.
 */
export function summariseReasons(items: readonly string[], maxGroups = 3): string {
  const groups = new Map<string, { count: number; rows: number[] }>();
  for (const item of items) {
    const m = /^Row (\d+): (.*)$/.exec(item);
    const reason = (m ? m[2] : item).replace(/"[^"]*"/g, '"..."');
    const g = groups.get(reason) ?? { count: 0, rows: [] };
    g.count++;
    if (m && g.rows.length < 3) g.rows.push(Number(m[1]));
    groups.set(reason, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  const shown = sorted.slice(0, maxGroups).map(([reason, g]) => {
    const rows = g.rows.length ? `, e.g. row${g.rows.length > 1 ? "s" : ""} ${g.rows.join(", ")}` : "";
    return `${reason} (${g.count}${rows})`;
  });
  const more = sorted.length > maxGroups ? `; and ${sorted.length - maxGroups} other reason(s)` : "";
  return shown.join("; ") + more;
}
