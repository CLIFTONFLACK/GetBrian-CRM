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
const SIZE_RANGE = new RegExp(`^(?:between\\s+)?${NUM}\\s*(?:to|-|and)\\s*${NUM}$`);
const SIZE_UPTO = new RegExp(
  `^(?:up\\s*to|max(?:imum)?(?:\\s+of)?|under|less\\s+than|no\\s+more\\s+than|below)\\s+${NUM}$`,
);
const SIZE_FROM = new RegExp(
  `^(?:from|min(?:imum)?(?:\\s+of)?|over|at\\s+least|more\\s+than|above)\\s+${NUM}$`,
);
const SIZE_PLUS = new RegExp(`^${NUM}\\s*\\+$`);
const SIZE_APPROX = new RegExp(`^(?:approx(?:imately)?\\.?|c\\.?|circa|about|around|~)\\s*${NUM}$`);
const SIZE_ONE = new RegExp(`^${NUM}$`);

const SIZE_UNIT_SRC =
  "(?<![a-z])(?:sq\\.?\\s*ft\\.?|sq\\.?\\s*f(?:ee|oo)t\\.?|sqft|sf|ft2|ft²|sq\\.?\\s*m(?:etres?|eters?)?\\.?|sqm|m2|m²)(?![a-z0-9])";
const SIZE_UNIT_G = new RegExp(SIZE_UNIT_SRC, "g");

const toNumber = (whole: string, frac?: string) =>
  Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);

const digitsToNine = (s: string) => s.replace(/\d/g, "9");

const isMetricUnit = (u: string) => /^(sq\.?\s*m|sqm|m2|m²)/.test(u) && !/^sq\.?\s*f/.test(u);

/** Two readings of one size, "2,000 sq ft (186 sq m)": keep the square-feet one. */
function pickSquareFeet(a: string, b: string): string | null {
  const ua = [...a.matchAll(SIZE_UNIT_G)];
  const ub = [...b.matchAll(SIZE_UNIT_G)];
  if (ua.length === 0 || ub.length === 0) return null;
  if (!isMetricUnit(ua[ua.length - 1][0])) return a;
  if (!isMetricUnit(ub[ub.length - 1][0])) return b;
  return a;
}

/**
 * "1,000 to 4,000 sq ft", "Up to 2,000 sq ft", "From 3,000 sq ft", "175 to 275 sq m".
 * Also "under / less than / maximum N" (a ceiling), "over / at least / more
 * than / minimum / N+" (a floor), "approx N", a unit on both numbers
 * ("1,000 sq ft - 2,000 sq ft") and a second reading in brackets ("2,000 sq ft
 * (186 sq m)", where the square-feet figure is used).
 */
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

  let text = raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");

  // A second reading in brackets or after a slash: keep one of them.
  const bracket = /^(.*?)\s*[([]\s*([^)\]]*?)\s*[)\]]$/.exec(text);
  if (bracket) {
    const picked = pickSquareFeet(bracket[1], bracket[2]);
    if (picked !== null) text = picked.trim();
  } else if (/\s\/\s/.test(text)) {
    const [a, b, ...rest] = text.split(/\s\/\s/);
    const picked = rest.length === 0 ? pickSquareFeet(a, b) : null;
    if (picked !== null) text = picked.trim();
  }

  // A unit on both numbers: "1,000 sq ft to 4,000 sq ft". Same family only.
  let units = [...text.matchAll(SIZE_UNIT_G)];
  if (units.length > 2) return bad;
  if (units.length === 2) {
    if (isMetricUnit(units[0][0]) !== isMetricUnit(units[1][0])) return bad;
    const first = units[0];
    text = `${text.slice(0, first.index)}${text.slice(first.index + first[0].length)}`
      .replace(/\s+/g, " ")
      .trim();
    units = [...text.matchAll(SIZE_UNIT_G)];
  }
  if (units.length !== 1) return bad;
  const unit = units[0];
  if (unit.index + unit[0].length !== text.length) return bad;

  const factor = isMetricUnit(unit[0]) ? SQM_TO_SQFT : 1;
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
  m = SIZE_FROM.exec(body) ?? SIZE_PLUS.exec(body);
  if (m) {
    const n = toNumber(m[1], m[2]);
    if (n <= 0) return bad;
    return { kind: "from", minSqft: conv(n), maxSqft: null, swapped: false, keepText: false, shape };
  }
  m = SIZE_APPROX.exec(body) ?? SIZE_ONE.exec(body);
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
  | "assumed_annual"
  | "floor"
  | "per_sqft"
  | "per_month"
  | "per_week"
  | "other_unit"
  | "no_unit"
  | "unparsed";

export type ParsedRent = {
  outcome: RentOutcome;
  /** Annual ceiling. Monthly and weekly figures are already multiplied up. */
  maxRent: number | null;
  /** Ceiling per square foot per year, from "£25 per sq ft". Never mixed into maxRent. */
  rentPsf: number | null;
  /** "Rent (as exported): ..." when the figure was not converted. */
  note: string | null;
  shape: string;
};

// A figure with no unit is read as annual only from this amount up.
const MIN_ASSUMED_ANNUAL = 1000;
// requirements.max_rent is numeric(12,2). A converted figure at or above this
// would overflow it ("numeric field overflow") and fail the row, so it stays in notes.
const MAX_RENT_PA = 1_000_000_000;
const ANNUAL_RE = /\bper\s*(annum|year|yr)\b|\bp\.?a\.?(?![a-z])|\bannually\b|\/\s*(annum|year)|\ba year\b/;
// Words that may sit around a bare figure without changing what it means.
const BARE_FILLER = /\b(up\s*to|upto|max(?:imum)?|budget|approx(?:imately)?|circa|about|around|to|and|c)\b/g;

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a rent cell means, read in this order:
 *  - a cell that is only a number: max_rent, as an explicit max_rent column always was;
 *  - a floor ("From", "min", "over", "at least", a trailing "+"): no ceiling, text kept;
 *  - per sq ft ("£25 per sq ft", "£25 psf", "£25/sq ft"): rentPsf, the top of a
 *    band. It is NEVER put in max_rent: a per-sq-ft figure stored as a yearly
 *    budget would make the requirement match almost nothing;
 *  - per month ("pcm", "pm", "per month") x 12, per week x 52: max_rent;
 *  - annual ("per annum", "pa", "per year"): the top of a band;
 *  - no unit at all ("Up to £50,000"): read as annual when the figure is 1,000
 *    or more, otherwise kept in notes.
 * Dollar and euro amounts are not read. Anything not converted keeps its text
 * in `note`.
 */
export function parseRent(cell: string | null | undefined): ParsedRent {
  if ((cell ?? "").length > MAX_CELL_CHARS) {
    return { outcome: "unparsed", maxRent: null, rentPsf: null, note: null, shape: "" };
  }
  const raw = (cell ?? "").trim();
  const shape = digitsToNine(raw);
  if (!raw) return { outcome: "empty", maxRent: null, rentPsf: null, note: null, shape };
  const note = `Rent (as exported): ${raw}`;
  const keep = (outcome: RentOutcome): ParsedRent => ({
    outcome,
    maxRent: null,
    rentPsf: null,
    note,
    shape,
  });
  const text = raw.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");

  // A cell that is only a number is a plain figure, as an explicit max_rent
  // column always was: digits, commas or spaces, optional £ and decimals.
  const plain = PLAIN_NUMBER_RE.exec(text);
  if (plain) {
    const n = Number(`${plain[1].replace(/[, ]/g, "")}${plain[2] ?? ""}`);
    return n > 0 && n < MAX_RENT_PA
      ? { outcome: "plain_number", maxRent: n, rentPsf: null, note: null, shape }
      : keep("unparsed");
  }
  if (/[$€]/.test(text)) return keep("unparsed");
  // "From", "min", "over", "at least" and a trailing "+" all describe a floor,
  // not a ceiling: there is no maximum to set, so the text stays in notes.
  if (FLOOR_RE.test(text)) return keep("floor");

  const amounts = amountsIn(text).filter((n) => n > 0);
  const usable = amounts.length >= 1 && amounts.length <= 2;
  const top = amounts.length ? Math.max(...amounts) : 0;

  if (/(per|\/|a)\s*sq\.?\s*(ft|foot|feet)|\bper\s*sf\b|\bpsf\b|per square f/.test(text)) {
    if (!usable || top > 1000) return keep("per_sqft");
    return { outcome: "per_sqft", maxRent: null, rentPsf: round2(top), note: null, shape };
  }
  if (/\bper\s*(calendar\s*)?(month|mth)\b|\bpcm\b|\bp\.c\.m\b|\bpm\b|\bmonthly\b/.test(text)) {
    if (!usable) return keep("per_month");
    // "£2,000 pcm (£24,000 pa)": the cell already holds the yearly figure. Do not
    // multiply the larger (yearly) amount by 12 again.
    if (amounts.length === 2 && ANNUAL_RE.test(text)) {
      return top < MAX_RENT_PA
        ? { outcome: "converted", maxRent: top, rentPsf: null, note: null, shape }
        : keep("per_month");
    }
    if (top * 12 >= MAX_RENT_PA) return keep("per_month");
    return { outcome: "per_month", maxRent: round2(top * 12), rentPsf: null, note: null, shape };
  }
  if (/\bper\s*(week|wk)\b|\bpw\b|\bweekly\b/.test(text)) {
    if (!usable) return keep("per_week");
    if (amounts.length === 2 && ANNUAL_RE.test(text)) {
      return top < MAX_RENT_PA
        ? { outcome: "converted", maxRent: top, rentPsf: null, note: null, shape }
        : keep("per_week");
    }
    if (top * 52 >= MAX_RENT_PA) return keep("per_week");
    return { outcome: "per_week", maxRent: round2(top * 52), rentPsf: null, note: null, shape };
  }
  const annual = ANNUAL_RE.test(text);
  if (annual) {
    if (amounts.length === 0 || amounts.length > 2 || top >= MAX_RENT_PA) return keep("unparsed");
    return { outcome: "converted", maxRent: top, rentPsf: null, note: null, shape };
  }
  if (/\bper\s+[a-z]/.test(text)) return keep("other_unit");

  // No unit at all. Read as annual only when nothing but the figure (and
  // filler such as "up to") is there and the figure is 1,000 or more.
  if (usable && top >= MIN_ASSUMED_ANNUAL && top < MAX_RENT_PA) {
    const rest = text
      .replace(AMOUNT_RE, " ")
      .replace(BARE_FILLER, " ")
      .replace(/[£\-,.\s]/g, "");
    if (rest === "") {
      return { outcome: "assumed_annual", maxRent: top, rentPsf: null, note: null, shape };
    }
  }
  return keep("no_unit");
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export type LatLngPair = { lat: number; lng: number };

export type LocationCatalogInput = {
  neighbourhoods: readonly string[];
  towns: readonly string[];
  counties: readonly string[];
  regions: readonly string[];
  districts: readonly string[];
  /**
   * Optional coordinates, [lat, lng], keyed by place name or postcode district
   * (any case, apostrophes ignored). Used only to resolve "within N miles of X".
   */
  coords?: Readonly<Record<string, readonly [number, number]>>;
};

export type LocationCatalog = {
  neighbourhood: Map<string, string>;
  town: Map<string, string>;
  county: Map<string, string>;
  region: Map<string, string>;
  districts: Set<string>;
  /** normName(place) -> coordinates. Empty when the input had none. */
  coords: Map<string, LatLngPair>;
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
  const coords = new Map<string, LatLngPair>();
  for (const [name, pair] of Object.entries(input.coords ?? {})) {
    const [lat, lng] = pair;
    if (Number.isFinite(lat) && Number.isFinite(lng)) coords.set(normName(name), { lat, lng });
  }
  return {
    neighbourhood: index(input.neighbourhoods),
    town: index(input.towns),
    county: index(input.counties),
    region: index(input.regions),
    districts: new Set(input.districts.map((d) => d.toUpperCase())),
    coords,
  };
}

export type AreaKind = "zone" | "neighbourhood" | "town" | "county" | "region" | "district";

/** "Within 3 miles of X": the place, its coordinates when known, the radius in miles. */
export type ParsedAnchor = {
  text: string;
  lat: number | null;
  lng: number | null;
  miles: number;
};

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
  /**
   * The first "within N miles of X" in the cell. lat and lng are null when X is
   * not in the gazetteer: the importer geocodes it later. At most one per cell;
   * a second one is unplaced and goes to notes.
   */
  anchor: ParsedAnchor | null;
  /** "Area (as exported): ..." when anything was not fully placed. */
  note: string | null;
};

const DISTRICT_SHAPE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const DISTRICT_RANGE = /^([A-Z]{1,2})(\d{1,2})\s*-\s*(?:\1)?(\d{1,2})$/;
const FLEX = /\s*\(\s*\+\s*[\d.]+\s*miles?\s*\)\s*$/i;
const MAX_RANGE = 20;

// "within 3 miles of X", "3 miles from X", "within 5 km of X", "within 2 miles radius of X".
const RADIUS_DIST =
  /^(?:within\s+)?(\d+(?:\.\d+)?)\s*(miles?|mi|km|kilomet(?:re|er)s?)(?:\s+radius)?\s+(?:of|from)\s+/i;
// "within 10 minutes walk of X", "10 min walk from X". 3 mph: miles = minutes / 20.
const RADIUS_WALK =
  /^(?:within\s+)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)(?:'s)?\s*walk(?:ing)?(?:\s+distance)?\s+(?:of|from)\s+/i;
// Driving time is not supported: such a token stays in notes.
const DRIVE_TIME = /\b\d+\s*(?:minutes?|mins?)\s*(?:drive|driving|by car)\b/i;
// "Zones 1, 2 and 3", "Zone 1/2", "Zone 1 & 2" (not ranges: "Zone 1-3" is handled by placeName).
const ZONE_LIST =
  /\bzones?\s*([1-9](?:\s*(?:,|and|&|\/|\+)\s*[1-9])*)(?![\d\w])(?!\s*(?:-|to)\s*\d)/gi;
const CONJUNCTION = /(\s+or\s+|\s+and\s+|\s*&\s*|\s+\+\s+)/i;
const KM_TO_MILES = 0.621371;
export const MIN_RADIUS_MILES = 0.1;
export const MAX_RADIUS_MILES = 50;

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

type Group = { hits: Hit[]; complete: boolean };

/** One name, or a slash group ("Kensington/Notting Hill": whole name first, then its parts). */
function placeSlashGroup(text: string, catalog: LocationCatalog): Group {
  const whole = placeName(text, catalog);
  if (whole) return { hits: whole, complete: true };
  if (!text.includes("/")) return { hits: [], complete: false };
  const hits: Hit[] = [];
  let complete = true;
  for (const part of text.split("/").map((p) => p.trim()).filter(Boolean)) {
    const h = placeName(part, catalog);
    if (h) hits.push(...h);
    else complete = false;
  }
  return { hits, complete };
}

/**
 * One comma-free token. The whole token is tried first, so a known name that
 * contains "and" or "&" is never cut. Then "or", "and", "&" and "+" split it,
 * and the longest run of pieces that is a known name wins ("Elephant and
 * Castle and Soho" is two places).
 */
function placeGroup(text: string, catalog: LocationCatalog): Group {
  const whole = placeSlashGroup(text, catalog);
  if (whole.complete) return whole;
  const pieces = text.split(CONJUNCTION); // [part, delimiter, part, ...]
  if (pieces.length < 3) return whole;
  const n = (pieces.length + 1) / 2;
  // The run search below costs about n cubed. A real cell names a handful of
  // places; a longer chain ("x and x and x ...", up to 1,000 pieces in a
  // 2,000-character cell) is left whole and kept in notes.
  if (n > 8) return whole;
  const hits: Hit[] = [];
  let complete = true;
  let i = 0;
  while (i < n) {
    let took = false;
    for (let j = n - 1; j > i; j--) {
      const joined = pieces.slice(2 * i, 2 * j + 1).join("");
      const h = placeName(joined, catalog);
      if (h) {
        hits.push(...h);
        i = j + 1;
        took = true;
        break;
      }
    }
    if (took) continue;
    const single = placeSlashGroup(pieces[2 * i].trim(), catalog);
    hits.push(...single.hits);
    if (!single.complete) complete = false;
    i++;
  }
  return hits.length > 0 ? { hits, complete } : whole;
}

/** Coordinates for the place a radius is measured from; null when unknown (to be geocoded). */
function anchorCoords(text: string, catalog: LocationCatalog): LatLngPair | null {
  const base = normName(text).replace(/\.+$/, "");
  const candidates = [
    base,
    base.replace(/,?\s*london$/, ""),
    base.replace(/^the\s+/, ""),
    base.replace(/\s+(?:tube\s+)?station$/, ""),
  ];
  for (const c of candidates) {
    const hit = catalog.coords.get(c);
    if (hit) return hit;
  }
  const upper = text.trim().toUpperCase().replace(/\s+/g, "");
  if (DISTRICT_SHAPE.test(upper)) return catalog.coords.get(normName(upper)) ?? null;
  return null;
}

/** Radius in miles and the length of the phrase, or null when the token does not start with one. */
function matchRadius(token: string): { miles: number; length: number } | null {
  const d = RADIUS_DIST.exec(token);
  if (d) {
    const n = Number(d[1]);
    const unit = d[2].toLowerCase();
    const miles = unit.startsWith("k") ? n * KM_TO_MILES : n;
    return { miles: Math.round(miles * 100) / 100, length: d[0].length };
  }
  const w = RADIUS_WALK.exec(token);
  if (w) return { miles: Math.round((Number(w[1]) / 20) * 100) / 100, length: w[0].length };
  return null;
}

/**
 * Turn a comma-separated Area cell into the requirement's target columns.
 * Anything that could not be placed is returned in `note`, verbatim, so no part
 * of the cell is ever lost. Whole names are matched before slash groups
 * ("Kensington/Notting Hill" is tried as one name, then as its parts) and
 * before "or" / "and" / "&" / "+" splits. A radius phrase ("within 3 miles of
 * X") becomes `anchor`; an address after "of" that starts with a number keeps
 * its own commas ("34-43 Russell Street, Covent Garden").
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
    anchor: null,
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

  // "Zones 1, 2 and 3" would be cut at its commas below: rewrite it first.
  const prepared = raw.replace(ZONE_LIST, (_m, digits: string) =>
    (digits.match(/[1-9]/g) ?? []).map((d) => `Zone ${d}`).join(", "),
  );

  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const segments = prepared.split(/[,;]/);
  const noteTokens: string[] = [];
  const reject = (text: string) => {
    out.unplaced.push(text);
    noteTokens.push(text);
  };
  const stopsAddress = (seg: string) => {
    if (matchRadius(seg)) return true;
    const h = placeName(seg, catalog);
    return !!h && h.every((x) => x.kind === "zone" || x.kind === "district");
  };

  for (let i = 0; i < segments.length; i++) {
    const original = clean(segments[i]);
    if (!original) continue;

    const radius = matchRadius(original);
    if (radius) {
      let place = original.slice(radius.length).trim();
      let whole = original;
      // An address starting with a number ("34-43 Russell Street, Covent
      // Garden") keeps up to two following segments: they belong to it.
      if (/^\d/.test(place)) {
        for (let extra = 0; extra < 2 && i + 1 < segments.length; extra++) {
          const next = clean(segments[i + 1]);
          if (!next || stopsAddress(next)) break;
          place += `, ${next}`;
          whole += `, ${next}`;
          i++;
        }
      }
      place = place.replace(/\.+$/, "").trim();
      const inRange = radius.miles >= MIN_RADIUS_MILES && radius.miles <= MAX_RADIUS_MILES;
      if (!place || out.anchor || !inRange) {
        reject(whole);
        continue;
      }
      const at = anchorCoords(place, catalog);
      out.anchor = { text: place, lat: at?.lat ?? null, lng: at?.lng ?? null, miles: radius.miles };
      continue;
    }
    if (DRIVE_TIME.test(original)) {
      reject(original);
      continue;
    }

    const flexed = FLEX.test(original);
    const token = original.replace(FLEX, "").replace(/\.$/, "").trim();
    if (!token) continue;
    let hits: Hit[] = [];
    let complete = true;

    const london = /^london\s*[-–]\s*(.+)$/i.exec(token);
    const londonDistrict = /^london\s+([A-Za-z]{1,2}\d[A-Za-z\d]?)$/i.exec(token);
    if (london) {
      hits = [{ kind: "region", value: catalog.region.get("london") ?? "London" }];
      // "London - Greater London" says nothing more than London; "London -
      // Central" is narrower than the region, so keep its text too.
      complete = normName(london[1]) === "greater london";
    } else if (londonDistrict) {
      hits = placeName(londonDistrict[1], catalog) ?? [];
      complete = hits.length > 0;
    } else {
      const g = placeGroup(token, catalog);
      hits = g.hits;
      complete = g.complete;
    }

    hits.forEach(add);
    if (hits.length === 0) {
      reject(original);
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
// Phone numbers
// ---------------------------------------------------------------------------

export type UkNumberClass = "mobile" | "landline" | "unknown";

/**
 * Mobile or landline, from the number alone. Spaces, dots, dashes and brackets
 * are ignored, a "(0)" after +44 is dropped, and a leading +44 or 0044 becomes
 * a leading 0. Mobile is 07 plus nine digits, except 070 (personal numbering)
 * and 076 (pagers), which are "unknown". Landline is 01, 02 or 03 plus nine
 * digits. 08, 09, short numbers, extensions and anything with letters are "unknown".
 */
export function classifyUkNumber(raw: string | null | undefined): UkNumberClass {
  if ((raw ?? "").length > 64) return "unknown";
  let s = (raw ?? "").trim();
  if (!s) return "unknown";
  s = s.replace(/^((?:\+|00)\s*44)\s*\(\s*0\s*\)/, "$1");
  s = s.replace(/[\s.\-()]/g, "");
  if (s.startsWith("+44")) s = `0${s.slice(3)}`;
  else if (s.startsWith("0044")) s = `0${s.slice(4)}`;
  if (!/^\d+$/.test(s)) return "unknown";
  if (/^07\d{9}$/.test(s)) return /^07[06]/.test(s) ? "unknown" : "mobile";
  if (/^0[123]\d{9}$/.test(s)) return "landline";
  return "unknown";
}

export type RoutedPhones = {
  phone: string | null;
  mobile: string | null;
  /** The Phone cell held a mobile and it now sits in mobile. */
  phoneToMobile: boolean;
  /** The Mobile cell held a landline and it now sits in phone. */
  mobileToPhone: boolean;
  /** Both cells hold the same known kind: each stays in its own column as exported. */
  sameClass: "mobile" | "landline" | null;
};

/**
 * File a contact's two phone cells by what each number is: a mobile-class
 * number goes to mobile, a landline-class number to phone, anything else stays
 * in the column it came from. When both cells would land in the same field they
 * are left exactly as exported (and `sameClass` says so when both are the same
 * known kind), so no number is ever dropped or replaced.
 */
export function routeContactPhones(
  phoneCell: string | null | undefined,
  mobileCell: string | null | undefined,
): RoutedPhones {
  const p = (phoneCell ?? "").trim();
  const m = (mobileCell ?? "").trim();
  const pc = classifyUkNumber(p);
  const mc = classifyUkNumber(m);
  const dest = (cls: UkNumberClass, own: "phone" | "mobile") =>
    cls === "mobile" ? "mobile" : cls === "landline" ? "phone" : own;
  const pd = dest(pc, "phone");
  const md = dest(mc, "mobile");
  const out: RoutedPhones = {
    phone: p || null,
    mobile: m || null,
    phoneToMobile: false,
    mobileToPhone: false,
    sameClass: null,
  };
  if (p && m && pd === md) {
    if (pc === mc && pc !== "unknown") out.sameClass = pc;
    return out;
  }
  out.phone = null;
  out.mobile = null;
  if (p) {
    if (pd === "mobile") {
      out.mobile = p;
      out.phoneToMobile = pc === "mobile";
    } else out.phone = p;
  }
  if (m) {
    if (md === "phone") {
      out.phone = m;
      out.mobileToPhone = mc === "landline";
    } else out.mobile = m;
  }
  return out;
}

/**
 * A company has one phone field. Given every number the row carries, the first
 * landline-class number (else the first number) is the phone; every other
 * number becomes a notes line, "Mobile (as exported): ..." for a mobile and
 * "Phone (as exported): ..." for the rest, so none is lost.
 */
export function planCompanyPhones(values: readonly string[]): {
  phone: string | null;
  extraLines: string[];
} {
  const numbers = [...new Set(values.map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const phone = numbers.find((v) => classifyUkNumber(v) === "landline") ?? numbers[0] ?? null;
  const extraLines = numbers
    .filter((v) => v !== phone)
    .map((v) =>
      classifyUkNumber(v) === "mobile" ? `Mobile (as exported): ${v}` : `Phone (as exported): ${v}`,
    );
  return { phone, extraLines };
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
