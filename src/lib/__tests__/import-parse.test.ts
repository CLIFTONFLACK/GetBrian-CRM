import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  buildLocationCatalog,
  capCell,
  hasLetterOrDigit,
  isMoreThanADayAhead,
  joinNoteLines,
  legacyRowRef,
  MAX_CELL_CHARS,
  mergeNotes,
  classifyUkNumber,
  planCompanyPhones,
  routeContactPhones,
  parseArea,
  parseBool,
  parseCompanyType,
  parseRent,
  parseSize,
  parseSourceDate,
  parseTenant,
  planAdoptions,
  summariseReasons,
  unionTags,
  type LegacyRowCells,
} from "../import-parse.ts";
import {
  addressChanged,
  anchorKey,
  inUkBox,
  MAX_ANCHOR_GEOCODES,
  capList,
  chunk,
  collectListingIds,
  dryRunFollowUp,
  followUpSummary,
  geocodeWindow,
  MAX_RESCORE_LISTINGS,
  shouldRescore,
  UPSERT_CHUNK,
} from "../import-followup.ts";
import { importFileKind, mapHeaders, parseCsv, toCsv } from "../csv.ts";
import {
  cellText,
  dateCellToIso,
  MAX_SHEET_COLS,
  MAX_SHEET_ROWS,
  WorkbookError,
  workbookToRows,
} from "../xlsx-rows.ts";

// ---------------------------------------------------------------- dates

const iso = (raw: string) => {
  const d = parseSourceDate(raw);
  assert.equal(d.kind, "ok", `expected "${raw}" to parse`);
  return d.kind === "ok" ? d.iso : "";
};

test("dates: ISO, with and without time", () => {
  assert.equal(iso("2025-11-04"), "2025-11-04T00:00:00.000Z");
  assert.equal(iso("2025-11-04 08:16:50"), "2025-11-04T08:16:50.000Z");
  assert.equal(iso("2025-11-04T08:16:50"), "2025-11-04T08:16:50.000Z");
  assert.equal(iso("2025-11-04T08:16:50.123"), "2025-11-04T08:16:50.000Z");
});

test("dates: naive times are Europe/London, so summer time is one hour behind UTC", () => {
  assert.equal(iso("2025-07-01 12:00:00"), "2025-07-01T11:00:00.000Z");
  assert.equal(iso("2025-01-15 12:00:00"), "2025-01-15T12:00:00.000Z");
  assert.equal(iso("01/07/2025 12:00"), "2025-07-01T11:00:00.000Z");
  // Either side of the clock change on 29 March 2026 (01:00 GMT becomes 02:00 BST).
  assert.equal(iso("2026-03-29 00:30:00"), "2026-03-29T00:30:00.000Z");
  assert.equal(iso("2026-03-29 03:30:00"), "2026-03-29T02:30:00.000Z");
});

test("dates: an explicit offset or Z is honoured, not replaced by London time", () => {
  assert.equal(iso("2025-07-01T12:00:00Z"), "2025-07-01T12:00:00.000Z");
  assert.equal(iso("2025-07-01T12:00:00+02:00"), "2025-07-01T10:00:00.000Z");
  assert.equal(iso("2025-07-01T12:00:00-0500"), "2025-07-01T17:00:00.000Z");
});

test("dates: UK day-first, never month-first", () => {
  assert.equal(iso("01/02/2026"), "2026-02-01T00:00:00.000Z"); // 1 February, not 2 January
  assert.equal(iso("1/2/2026"), "2026-02-01T00:00:00.000Z");
  assert.equal(iso("13/01/2026 14:30"), "2026-01-13T14:30:00.000Z");
  assert.equal(iso("13/01/2026 14:30:15"), "2026-01-13T14:30:15.000Z");
  assert.equal(iso("04.11.2025"), "2025-11-04T00:00:00.000Z");
  // The American reading of this would be valid (13 January); day-first makes it month 13.
  assert.equal(parseSourceDate("01/13/2026").kind, "invalid");
});

test("dates: impossible dates and times are rejected", () => {
  for (const bad of [
    "31/02/2026",
    "2026-02-30",
    "30/02/2024",
    "29/02/2025",
    "2026-13-01",
    "00/01/2026",
    "01/00/2026",
    "2026-01-01 24:00:00",
    "2026-01-01 12:60",
    "2026-01-01 12:30:61",
  ]) {
    assert.equal(parseSourceDate(bad).kind, "invalid", bad);
  }
  assert.equal(iso("29/02/2024"), "2024-02-29T00:00:00.000Z"); // a real leap day
});

test("dates: Excel serial numbers, fractional days included", () => {
  assert.equal(iso("45965.345023148"), "2025-11-04T08:16:50.000Z");
  assert.equal(iso("45839.5"), "2025-07-01T11:00:00.000Z"); // 12:00 London wall time in July
  assert.equal(iso("45965"), "2025-11-04T00:00:00.000Z");
  assert.equal(parseSourceDate("12345").kind, "invalid"); // before 1954
  assert.equal(parseSourceDate("123456").kind, "invalid");
  assert.equal(parseSourceDate("99999").kind, "invalid");
});

test("dates: blank is empty, nonsense is invalid and is never guessed", () => {
  assert.equal(parseSourceDate("").kind, "empty");
  assert.equal(parseSourceDate("   ").kind, "empty");
  assert.equal(parseSourceDate(null).kind, "empty");
  assert.equal(parseSourceDate(undefined).kind, "empty");
  for (const bad of ["yesterday", "N/A", "01/02/26", "2026", "Feb 1 2026", "1/2"]) {
    assert.equal(parseSourceDate(bad).kind, "invalid", bad);
  }
});

// ---------------------------------------------------------------- notes

test("mergeNotes: empty stored notes take the incoming text", () => {
  assert.equal(mergeNotes(null, "Key operator"), "Key operator");
  assert.equal(mergeNotes("", "Key operator"), "Key operator");
  assert.equal(mergeNotes("  \n ", "  Key operator  "), "Key operator");
});

test("mergeNotes: lines already stored are not repeated", () => {
  assert.equal(mergeNotes("Key operator", "Key operator"), "Key operator");
  assert.equal(mergeNotes("Key operator", "  Key operator  "), "Key operator");
  assert.equal(mergeNotes("Met at expo\nKey operator", "Key operator\nMet at expo"), "Met at expo\nKey operator");
  // Idempotent: applying the same import twice changes nothing the second time.
  const once = mergeNotes("Old note", "New note\nSecond line");
  assert.equal(mergeNotes(once, "New note\nSecond line"), once);
});

test("mergeNotes: no substring test - a longer stored line does not hide a shorter incoming one", () => {
  // Old behaviour (stored.includes(incoming)) would have left this unchanged.
  assert.equal(
    mergeNotes("Met at expo. Key operator.", "Key operator"),
    "Met at expo. Key operator.\n\nKey operator",
  );
  assert.equal(
    mergeNotes("Rent (as exported): Up to 500", "Rent (as exported): Up to 50"),
    "Rent (as exported): Up to 500\n\nRent (as exported): Up to 50",
  );
});

test("mergeNotes: an (as exported) line with the same label and a new value is appended, nothing replaced", () => {
  const out = mergeNotes("Rent (as exported): Up to 100\nMet Sam", "Rent (as exported): Up to 200");
  assert.equal(out, "Rent (as exported): Up to 100\nMet Sam\n\nRent (as exported): Up to 200");
});

test("mergeNotes: only the new lines are appended, and blank-line paragraphs of the new text are kept", () => {
  const out = mergeNotes("A\nB", "A\nC\n\nD\nB");
  assert.equal(out, "A\nB\n\nC\n\nD");
  assert.equal(mergeNotes("A", "\n\nB\n\n"), "A\n\nB");
});

test("mergeNotes: empty stored notes take the incoming text, stored text is never lost", () => {
  assert.equal(mergeNotes("", "x\n\ny"), "x\n\ny");
  const out = mergeNotes("Stored one\nStored two", "New");
  assert.ok(out.startsWith("Stored one\nStored two"));
});

test("mergeNotes: line comparison is case-sensitive and blank incoming changes nothing", () => {
  assert.equal(mergeNotes("key operator", "Key operator"), "key operator\n\nKey operator");
  assert.equal(mergeNotes("Old note", ""), "Old note");
  assert.equal(mergeNotes("Old note", "   "), "Old note");
  assert.equal(mergeNotes("Old note", null), "Old note");
  assert.equal(mergeNotes(null, null), "");
});

test("joinNoteLines drops blanks and joins with newlines", () => {
  assert.equal(joinNoteLines("a", "", null, " b "), "a\nb");
  assert.equal(joinNoteLines("", null, undefined), null);
});

// ---------------------------------------------------------------- booleans

test("parseBool accepts the usual spellings and flags the rest", () => {
  for (const t of ["Yes", "yes", "Y", "TRUE", "true", "1", " yes "]) assert.equal(parseBool(t), true, t);
  for (const f of ["No", "no", "N", "FALSE", "false", "0"]) assert.equal(parseBool(f), false, f);
  assert.equal(parseBool(""), null);
  assert.equal(parseBool("  "), null);
  assert.equal(parseBool("maybe"), "invalid");
  assert.equal(parseBool("2"), "invalid");
});

// ---------------------------------------------------------------- size

test("size: the real shapes", () => {
  const r = parseSize("1,000 to 4,000 sq ft");
  assert.deepEqual([r.kind, r.minSqft, r.maxSqft, r.keepText], ["range", 1000, 4000, false]);
  const s = parseSize("500 to 1,500 sq ft");
  assert.deepEqual([s.minSqft, s.maxSqft], [500, 1500]);
  const up = parseSize("Up to 2,000 sq ft");
  assert.deepEqual([up.kind, up.minSqft, up.maxSqft, up.keepText], ["upto", null, 2000, false]);
  const from = parseSize("From 3,000 sq ft");
  assert.deepEqual([from.kind, from.minSqft, from.maxSqft, from.keepText], ["from", 3000, null, false]);
});

test("size: a single figure goes in max only and the text stays in notes", () => {
  const r = parseSize("2,500 sq ft");
  assert.deepEqual([r.kind, r.minSqft, r.maxSqft, r.keepText], ["single", null, 2500, true]);
});

test("size: square metres are converted to square feet and rounded", () => {
  const r = parseSize("175 to 275 sq m");
  assert.deepEqual([r.minSqft, r.maxSqft], [1884, 2960]); // 175 x 10.7639, 275 x 10.7639
  assert.equal(parseSize("Up to 99 sq m").maxSqft, 1066);
  assert.equal(parseSize("From 100 sqm").minSqft, 1076);
  assert.equal(parseSize("100 to 200 m2").maxSqft, 2153);
});

test("size: large and awkwardly written figures", () => {
  assert.equal(parseSize("Up to 1,000,000 sq ft").maxSqft, 1_000_000);
  assert.equal(parseSize("1,000 – 2,000 sq ft").maxSqft, 2000); // en dash
  assert.equal(parseSize("  1000   to   2000  SQ  FT ").minSqft, 1000);
  assert.equal(parseSize("1000-2000 sq. ft.").maxSqft, 2000);
});

test("size: a reversed range is put the right way round and flagged", () => {
  const r = parseSize("4,000 to 1,000 sq ft");
  assert.deepEqual([r.minSqft, r.maxSqft, r.swapped], [1000, 4000, true]);
  assert.equal(parseSize("1,000 to 4,000 sq ft").swapped, false);
});

test("size: empty, no unit, zero and gibberish are not read", () => {
  assert.equal(parseSize("").kind, "empty");
  assert.equal(parseSize("   ").kind, "empty");
  assert.equal(parseSize(null).kind, "empty");
  for (const bad of ["1,000 to 4,000", "large", "0 sq ft", "1,00 sq ft", "£5 sq ft", "1000 to sq ft"]) {
    const r = parseSize(bad);
    assert.equal(r.kind, "unparsed", bad);
    assert.equal(r.keepText, true, bad);
    assert.equal(r.minSqft, null, bad);
    assert.equal(r.maxSqft, null, bad);
  }
  assert.equal(parseSize("1,000 to 4,000 sq ft").shape, "9,999 to 9,999 sq ft");
});

test("size: under, less than and maximum give a ceiling only; over, at least, more than, minimum and N+ a floor only", () => {
  for (const cell of ["Under 2,000 sq ft", "Less than 2,000 sq ft", "less than 2000 sq ft", "Maximum 2,000 sq ft", "Max 2,000 sq ft"]) {
    const r = parseSize(cell);
    assert.deepEqual([r.kind, r.minSqft, r.maxSqft, r.keepText], ["upto", null, 2000, false], cell);
  }
  for (const cell of ["Over 2,000 sq ft", "At least 2,000 sq ft", "More than 2,000 sq ft", "Minimum 2,000 sq ft", "2,000+ sq ft", "2,000 + sq ft"]) {
    const r = parseSize(cell);
    assert.deepEqual([r.kind, r.minSqft, r.maxSqft, r.keepText], ["from", 2000, null, false], cell);
  }
  // Metric figures convert the same way.
  assert.equal(parseSize("Over 100 sq m").minSqft, 1076);
});

test("size: approx, c. and circa read as one figure, kept in notes like any single figure", () => {
  for (const cell of ["approx 2,000 sq ft", "c. 2,000 sq ft", "Circa 2,000 sq ft", "approximately 2000 sq ft"]) {
    const r = parseSize(cell);
    assert.deepEqual([r.kind, r.maxSqft, r.keepText], ["single", 2000, true], cell);
  }
});

test("size: a unit on both numbers is read as a range", () => {
  const r = parseSize("1,000 sq ft to 4,000 sq ft");
  assert.deepEqual([r.kind, r.minSqft, r.maxSqft], ["range", 1000, 4000]);
  const dash = parseSize("1,000 sq ft - 2,000 sq ft");
  assert.deepEqual([dash.kind, dash.minSqft, dash.maxSqft], ["range", 1000, 2000]);
  const metric = parseSize("100 sq m to 200 sq m");
  assert.deepEqual([metric.minSqft, metric.maxSqft], [1076, 2153]);
  // Two different units on a range cannot be combined.
  assert.equal(parseSize("1,000 sq ft to 200 sq m").kind, "unparsed");
});

test("size: sq ft and sq m together take the sq ft figure, either way round", () => {
  const a = parseSize("2,000 sq ft (186 sq m)");
  assert.deepEqual([a.kind, a.maxSqft, a.keepText], ["single", 2000, true]);
  const b = parseSize("186 sq m (2,000 sq ft)");
  assert.equal(b.maxSqft, 2000);
  const c = parseSize("1,000 - 2,000 sq ft (93 - 186 sq m)");
  assert.deepEqual([c.kind, c.minSqft, c.maxSqft], ["range", 1000, 2000]);
  const d = parseSize("2,000 sq ft / 186 sq m");
  assert.equal(d.maxSqft, 2000);
});

test("size: sqft, sf, ft2 and ft² are all square feet", () => {
  for (const cell of ["1,000 to 2,000 sqft", "1,000 to 2,000 sf", "1,000 to 2,000 ft2", "1,000 to 2,000 ft²", "1,000 to 2,000 SF"]) {
    const r = parseSize(cell);
    assert.deepEqual([r.kind, r.minSqft, r.maxSqft], ["range", 1000, 2000], cell);
  }
  // A word that merely ends in "sf" or "m2" is not a unit.
  assert.equal(parseSize("1,000 to 2,000 oversf").kind, "unparsed");
});

// ---------------------------------------------------------------- rent

test("rent: annual ceilings become max_rent", () => {
  const up = parseRent("Up to £100,000 per annum");
  assert.deepEqual([up.outcome, up.maxRent, up.note], ["converted", 100000, null]);
  const band = parseRent("£50,000 - £100,000 per annum");
  assert.deepEqual([band.outcome, band.maxRent], ["converted", 100000]);
  assert.equal(parseRent("Up to £1,000,000 per annum").maxRent, 1_000_000);
  assert.equal(parseRent("UP TO £75,000 PER ANNUM").maxRent, 75000);
  assert.equal(parseRent("Up to £ 75,000 per annum").maxRent, 75000);
  assert.equal(parseRent("Up to £75000 per annum").maxRent, 75000);
  assert.equal(parseRent("up to 75k per annum").maxRent, 75000);
});

test("rent: a reversed band still takes the larger figure", () => {
  assert.equal(parseRent("£100,000 - £50,000 per annum").maxRent, 100000);
});

test("rent: a cell that is only a number sets max_rent, as an explicit max_rent column always did", () => {
  for (const [cell, n] of [
    ["100000", 100000],
    ["100,000", 100000],
    ["1,000,000", 1000000],
    ["  75 000 ", 75000],
    ["£100,000", 100000],
    ["£ 100,000", 100000],
    ["100000.50", 100000.5],
  ] as [string, number][]) {
    const r = parseRent(cell);
    assert.deepEqual([r.outcome, r.maxRent, r.note], ["plain_number", n, null], cell);
  }
  assert.equal(parseRent("0").outcome, "unparsed");
  assert.equal(parseRent("1,00,000").outcome === "plain_number", false);
});

test("rent: text with no unit is read as annual from 1,000 up, else kept in notes", () => {
  const r = parseRent("Up to £50,000");
  assert.deepEqual([r.outcome, r.maxRent, r.note], ["assumed_annual", 50000, null]);
  const band = parseRent("£50,000 - £100,000");
  assert.deepEqual([band.outcome, band.maxRent], ["assumed_annual", 100000]);
  assert.equal(parseRent("Up to 75k").maxRent, 75000);
  // Below 1,000 a bare figure could be a per-sq-ft rate: it stays in notes.
  const small = parseRent("Up to £50");
  assert.deepEqual([small.outcome, small.maxRent, small.note], ["no_unit", null, "Rent (as exported): Up to £50"]);
  // Words other than filler around the figure: not read.
  assert.equal(parseRent("Up to £50,000 plus VAT").outcome, "no_unit");
  assert.equal(parseRent("£50,000 - £100,000 - £150,000").outcome, "no_unit");
});

test("rent: a floor (from, min, minimum, over, above, at least, trailing +) has no max and keeps its text", () => {
  for (const cell of [
    "From £50,000 per annum",
    "Min £50,000 per annum",
    "Minimum £50,000 per annum",
    "Over £50,000 per annum",
    "Above £50,000 per annum",
    "At least £50,000 per annum",
    "£50,000+ per annum",
    "£50,000+",
    "From £50,000",
  ]) {
    const r = parseRent(cell);
    assert.deepEqual([r.outcome, r.maxRent, r.note], ["floor", null, `Rent (as exported): ${cell}`], cell);
  }
  // A ceiling that merely contains one of the words as part of another word is unaffected.
  assert.equal(parseRent("Up to £50,000 per annum, overheads excluded").maxRent, 50000);
});

test("rent: per sq ft goes to rentPsf and never to max_rent", () => {
  const sqft = parseRent("Up to £100 per sq ft");
  assert.deepEqual([sqft.outcome, sqft.maxRent, sqft.rentPsf, sqft.note], ["per_sqft", null, 100, null]);
  const band = parseRent("£50 - £80 per sq ft");
  assert.deepEqual([band.outcome, band.maxRent, band.rentPsf], ["per_sqft", null, 80]);
  for (const cell of ["£25 per sq ft", "£25 psf", "£25/sq ft", "£25 per sq ft pa", "£25 per sqft", "£25 per sq. ft."]) {
    const r = parseRent(cell);
    assert.deepEqual([r.outcome, r.maxRent, r.rentPsf, r.note], ["per_sqft", null, 25, null], cell);
  }
  assert.equal(parseRent("£12.50 psf").rentPsf, 12.5);
  // A floor per sq ft has no ceiling.
  const floor = parseRent("From £25 per sq ft");
  assert.deepEqual([floor.outcome, floor.maxRent, floor.rentPsf], ["floor", null, null]);
  // An absurd per-sq-ft figure is not trusted: text kept.
  const silly = parseRent("£5,000 per sq ft");
  assert.deepEqual([silly.outcome, silly.rentPsf, silly.note], ["per_sqft", null, "Rent (as exported): £5,000 per sq ft"]);
});

test("rent: per month is x12 and per week is x52, into the annual max_rent", () => {
  const month = parseRent("Up to £5,000 per month");
  assert.deepEqual([month.outcome, month.maxRent, month.rentPsf, month.note], ["per_month", 60000, null, null]);
  assert.equal(parseRent("£5,000 pcm").maxRent, 60000);
  assert.equal(parseRent("£5,000 pm").maxRent, 60000);
  assert.equal(parseRent("£4,000 - £5,000 per calendar month").maxRent, 60000);
  const week = parseRent("£100,000 per week");
  assert.deepEqual([week.outcome, week.maxRent], ["per_week", 5_200_000]);
  assert.equal(parseRent("£1,000 pw").maxRent, 52000);
  // A floor per month has no ceiling.
  assert.equal(parseRent("From £5,000 pcm").outcome, "floor");
  assert.equal(parseRent("Up to £100,000 per hour").outcome, "other_unit");
  assert.equal(parseRent("100000").outcome, "plain_number"); // a bare number is a plain figure
});

test("rent: empty, foreign currency and too many figures are not converted", () => {
  assert.deepEqual(parseRent(""), { outcome: "empty", maxRent: null, rentPsf: null, note: null, shape: "" });
  assert.equal(parseRent("   ").outcome, "empty");
  assert.equal(parseRent("Up to $100,000 per annum").outcome, "unparsed");
  assert.equal(parseRent("Up to €100,000 per annum").maxRent, null);
  assert.equal(parseRent("£1 - £2 - £3 per annum").outcome, "unparsed");
  assert.equal(parseRent("£0 per annum").outcome, "unparsed");
  assert.equal(parseRent("per annum").outcome, "unparsed");
});

// ---------------------------------------------------------------- area

const catalog = buildLocationCatalog({
  neighbourhoods: ["Soho", "Kensington", "Notting Hill", "King's Cross", "Marylebone", "Shepherd's Bush"],
  towns: ["Richmond", "Glasgow"],
  counties: ["Surrey"],
  regions: ["London", "North West", "Wales", "West Midlands"],
  districts: ["W1D", "W1F", "WC2A", "WC2B", "EC1A", "EC2A", "EC3A", "EC4A", "SW1A", "W10"],
});

test("area: zones", () => {
  const a = parseArea("Zone 1, Zone 2", catalog);
  assert.deepEqual(a.zones, ["Zone 1", "Zone 2"]);
  assert.equal(a.note, null);
  assert.deepEqual(parseArea("zone 3", catalog).zones, ["Zone 3"]);
  assert.deepEqual(parseArea("Zone 1-3", catalog).zones, ["Zone 1", "Zone 2", "Zone 3"]);
  assert.equal(parseArea("Zone 0", catalog).zones.length, 0);
});

test("area: postcode districts, including partial codes, lower case and ranges", () => {
  assert.deepEqual(parseArea("W1, WC2", catalog).districts, ["W1", "WC2"]);
  assert.deepEqual(parseArea("w1", catalog).districts, ["W1"]);
  assert.deepEqual(parseArea("SW1A", catalog).districts, ["SW1A"]);
  assert.deepEqual(parseArea("W10", catalog).districts, ["W10"]);
  assert.deepEqual(parseArea("EC1-4", catalog).districts, ["EC1", "EC2", "EC3", "EC4"]);
  assert.deepEqual(parseArea("EC4-1", catalog).districts, ["EC1", "EC2", "EC3", "EC4"]);
  assert.deepEqual(parseArea("EC1-EC4", catalog).districts, ["EC1", "EC2", "EC3", "EC4"]);
});

test("area: codes that are not real districts are left alone and kept in notes", () => {
  const a = parseArea("ZZ9, EC1-9, W1X1", catalog);
  assert.deepEqual(a.districts, []);
  assert.deepEqual(a.unplaced, ["ZZ9", "EC1-9", "W1X1"]);
  assert.equal(a.note, "Area (as exported): ZZ9, EC1-9, W1X1");
});

test("area: neighbourhoods, towns, counties, regions; slash groups split into parts", () => {
  const a = parseArea("Soho, Richmond, Surrey, North West", catalog);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.deepEqual(a.towns, ["Richmond"]);
  assert.deepEqual(a.counties, ["Surrey"]);
  assert.deepEqual(a.regions, ["North West"]);
  const g = parseArea("Kensington/Notting Hill", catalog);
  assert.deepEqual(g.neighbourhoods, ["Kensington", "Notting Hill"]);
  assert.equal(g.note, null);
  assert.deepEqual(parseArea("West midlands/wales", catalog).regions, ["West Midlands", "Wales"]);
});

test("area: apostrophes and case do not stop a match", () => {
  assert.deepEqual(parseArea("Kings Cross, shepherds bush", catalog).neighbourhoods, [
    "King's Cross",
    "Shepherd's Bush",
  ]);
});

test("area: London - X maps to the London region; narrower text stays in notes", () => {
  const all = parseArea("London - Greater London", catalog);
  assert.deepEqual(all.regions, ["London"]);
  assert.equal(all.note, null);
  const central = parseArea("London - Central", catalog);
  assert.deepEqual(central.regions, ["London"]);
  assert.equal(central.note, "Area (as exported): London - Central");
  assert.deepEqual(parseArea("London W1", catalog).districts, ["W1"]);
});

test("area: a radius phrase is an anchor, not unplaced text; unknown names are unplaced and kept verbatim", () => {
  const a = parseArea("Within 3 miles of Berwick Street, Yorkshire, Soho", catalog);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.deepEqual(a.anchor, { text: "Berwick Street", lat: null, lng: null, miles: 3 });
  assert.deepEqual(a.unplaced, ["Yorkshire"]);
  assert.equal(a.note, "Area (as exported): Yorkshire");
});

test("area: a flexible-radius suffix is placed and the original text is kept too", () => {
  const a = parseArea("Soho (+ 1 miles)", catalog);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.deepEqual(a.partial, ["Soho (+ 1 miles)"]);
  assert.equal(a.note, "Area (as exported): Soho (+ 1 miles)");
});

test("area: part of a slash group placed, the rest kept", () => {
  const a = parseArea("South West / West Wales, Soho/Nowhere", catalog);
  assert.deepEqual(a.regions, []);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.deepEqual(a.partial, ["Soho/Nowhere"]);
  assert.deepEqual(a.unplaced, ["South West / West Wales"]);
});

test("area: empty and whitespace cells; duplicates collapse; counts by kind", () => {
  assert.equal(parseArea("", catalog).note, null);
  assert.equal(parseArea("  , ,", catalog).note, null);
  const a = parseArea("Soho, soho, Zone 1", catalog);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.equal(a.placed.neighbourhood, 2); // counted per token placed, not per distinct value
  assert.equal(a.placed.zone, 1);
});

const geoCatalog = buildLocationCatalog({
  neighbourhoods: ["Soho", "King's Cross", "Brick Lane", "Elephant and Castle", "Covent Garden", "Notting Hill", "Kensington"],
  towns: ["Reading"],
  counties: ["Surrey"],
  regions: ["London"],
  districts: ["W1D", "W1F", "WC2A", "EC1A", "SW1A"],
  coords: {
    Soho: [51.5136, -0.1365],
    "King's Cross": [51.5309, -0.1233],
    Reading: [51.4543, -0.9781],
    W1D: [51.5133, -0.1325],
  },
});

test("area: zones joined by and, &, / or commas", () => {
  for (const cell of ["Zone 1 and 2", "Zones 1 & 2", "Zone 1/2", "Zones 1, 2", "zone 1 + 2"]) {
    const a = parseArea(cell, geoCatalog);
    assert.deepEqual(a.zones, ["Zone 1", "Zone 2"], cell);
    assert.equal(a.note, null, cell);
  }
  const three = parseArea("Zones 1, 2 and 3", geoCatalog);
  assert.deepEqual(three.zones, ["Zone 1", "Zone 2", "Zone 3"]);
  assert.equal(three.note, null);
  // A range keeps working, and other names in the cell are unaffected.
  assert.deepEqual(parseArea("Zone 1-3", geoCatalog).zones, ["Zone 1", "Zone 2", "Zone 3"]);
  const mixed = parseArea("Zones 1 and 2, Soho", geoCatalog);
  assert.deepEqual([mixed.zones, mixed.neighbourhoods], [["Zone 1", "Zone 2"], ["Soho"]]);
});

test("area: or, and, & and + split a token, and the semicolon splits like a comma", () => {
  const a = parseArea("Soho or Kensington", geoCatalog);
  assert.deepEqual(a.neighbourhoods, ["Soho", "Kensington"]);
  assert.equal(a.note, null);
  assert.deepEqual(parseArea("Soho and Reading", geoCatalog).neighbourhoods, ["Soho"]);
  assert.deepEqual(parseArea("Soho & Kensington + Notting Hill", geoCatalog).neighbourhoods, [
    "Soho",
    "Kensington",
    "Notting Hill",
  ]);
  assert.deepEqual(parseArea("Soho; Kensington", geoCatalog).neighbourhoods, ["Soho", "Kensington"]);
  // A part nobody knows keeps the whole token in notes.
  const p = parseArea("Soho and Nowhere", geoCatalog);
  assert.deepEqual(p.neighbourhoods, ["Soho"]);
  assert.deepEqual(p.partial, ["Soho and Nowhere"]);
  assert.equal(p.note, "Area (as exported): Soho and Nowhere");
});

test("area: a known multi-word name is never split, and the longest known name wins", () => {
  const e = parseArea("Elephant and Castle", geoCatalog);
  assert.deepEqual(e.neighbourhoods, ["Elephant and Castle"]);
  assert.equal(e.note, null);
  const both = parseArea("Elephant and Castle and Soho", geoCatalog);
  assert.deepEqual(both.neighbourhoods, ["Elephant and Castle", "Soho"]);
  assert.equal(both.note, null);
  assert.deepEqual(parseArea("Brick Lane or Soho", geoCatalog).neighbourhoods, ["Brick Lane", "Soho"]);
  assert.deepEqual(parseArea("Brick Lane", geoCatalog).neighbourhoods, ["Brick Lane"]);
});

test("area: within N miles of a known place is an anchor with coordinates and is not repeated in notes", () => {
  const a = parseArea("Within 3 miles of Soho", geoCatalog);
  assert.deepEqual(a.anchor, { text: "Soho", lat: 51.5136, lng: -0.1365, miles: 3 });
  assert.equal(a.note, null);
  assert.deepEqual(a.unplaced, []);
  assert.deepEqual(a.neighbourhoods, []); // the place is a centre, not a target by name
  // Apostrophe-free spelling still finds the stored name.
  const k = parseArea("within 1 mile of Kings Cross", geoCatalog);
  assert.deepEqual([k.anchor?.lat, k.anchor?.lng, k.anchor?.miles], [51.5309, -0.1233, 1]);
  // Postcode district, and a bare town.
  assert.equal(parseArea("within 2 miles of W1D", geoCatalog).anchor?.lat, 51.5133);
  assert.equal(parseArea("within 10 miles of Reading", geoCatalog).anchor?.lng, -0.9781);
  // Placed names next to an anchor still place.
  const mixed = parseArea("Within 3 miles of Soho, Zone 1", geoCatalog);
  assert.deepEqual(mixed.zones, ["Zone 1"]);
  assert.notEqual(mixed.anchor, null);
});

test("area: radius phrase spellings: miles from, km, walking minutes", () => {
  assert.equal(parseArea("3 miles from Soho", geoCatalog).anchor?.miles, 3);
  assert.equal(parseArea("within 0.5 mi of Soho", geoCatalog).anchor?.miles, 0.5);
  assert.equal(parseArea("within 10 km of Soho", geoCatalog).anchor?.miles, 6.21);
  assert.equal(parseArea("within 10 minutes walk of Soho", geoCatalog).anchor?.miles, 0.5);
  assert.equal(parseArea("15 min walk from Soho", geoCatalog).anchor?.miles, 0.75);
  assert.equal(parseArea("within 20 minutes walking distance of Soho", geoCatalog).anchor?.miles, 1);
});

test("area: an unknown place keeps its text and radius, coordinates null, and is not dropped to notes", () => {
  const a = parseArea("Within 2 miles of Berwick Street", geoCatalog);
  assert.deepEqual(a.anchor, { text: "Berwick Street", lat: null, lng: null, miles: 2 });
  assert.equal(a.note, null);
  assert.deepEqual(a.unplaced, []);
});

test("area: an address after 'of' keeps its commas", () => {
  const a = parseArea("within 3 miles of 34-43 Russell Street, Covent Garden", geoCatalog);
  assert.deepEqual(a.anchor, { text: "34-43 Russell Street, Covent Garden", lat: null, lng: null, miles: 3 });
  assert.deepEqual(a.neighbourhoods, []);
  assert.equal(a.note, null);
  // Zones and districts after the address are still targets of their own.
  const b = parseArea("within 3 miles of 34 Russell Street, Covent Garden, Zone 1", geoCatalog);
  assert.equal(b.anchor?.text, "34 Russell Street, Covent Garden");
  assert.deepEqual(b.zones, ["Zone 1"]);
  // A name that does not start with a number is cut at the comma as before.
  const c = parseArea("within 3 miles of Berwick Street, Soho", geoCatalog);
  assert.equal(c.anchor?.text, "Berwick Street");
  assert.deepEqual(c.neighbourhoods, ["Soho"]);
});

test("area: only one anchor per cell; the rest, driving times and out-of-range radii go to notes", () => {
  const two = parseArea("within 3 miles of Soho, within 5 miles of Reading", geoCatalog);
  assert.equal(two.anchor?.text, "Soho");
  assert.deepEqual(two.unplaced, ["within 5 miles of Reading"]);
  assert.equal(two.note, "Area (as exported): within 5 miles of Reading");
  const drive = parseArea("20 minutes drive from Soho", geoCatalog);
  assert.equal(drive.anchor, null);
  assert.equal(drive.note, "Area (as exported): 20 minutes drive from Soho");
  const far = parseArea("within 80 miles of Soho", geoCatalog);
  assert.equal(far.anchor, null);
  assert.equal(far.note, "Area (as exported): within 80 miles of Soho");
  assert.equal(parseArea("within 0 miles of Soho", geoCatalog).anchor, null);
});

test("area: the flex suffix still places the name and keeps the text", () => {
  const a = parseArea("Soho (+1 miles)", geoCatalog);
  assert.deepEqual(a.neighbourhoods, ["Soho"]);
  assert.equal(a.anchor, null);
  assert.equal(a.note, "Area (as exported): Soho (+1 miles)");
});

// ---------------------------------------------------------------- phone

test("phone: UK mobiles, in every written form", () => {
  for (const n of [
    "07700 900123",
    "07700900123",
    "07700-900-123",
    "07700.900.123",
    "(07700) 900123",
    "+44 7700 900123",
    "+44 (0)7700 900123",
    "+44(0)7700900123",
    "0044 7700 900123",
    "  07700 900 123  ",
  ]) {
    assert.equal(classifyUkNumber(n), "mobile", n);
  }
});

test("phone: UK landlines: 01, 02 and 03", () => {
  for (const n of ["020 7946 0018", "02079460018", "+44 20 7946 0018", "+44 (0) 20 7946 0018", "0161 496 0000", "0113 496 0000", "01632 960001", "0300 123 4567", "(020) 7946 0018"]) {
    // 01632 960001 is 11 digits in total: 01 + nine digits
    assert.equal(classifyUkNumber(n), "landline", n);
  }
});

test("phone: personal numbering and pagers (070, 076), 08, 09, short and odd numbers are unknown", () => {
  for (const n of [
    "07000 123456",
    "07600 123456",
    "0800 123 4567",
    "0845 123 4567",
    "0905 123 4567",
    "999",
    "12345",
    "07700 90012", // one digit short
    "07700 9001234", // one digit long
    "020 7946 001", // one digit short
    "+1 202 555 0100",
    "07700 900123 ext 5",
    "n/a",
    "",
    "   ",
  ]) {
    assert.equal(classifyUkNumber(n), "unknown", JSON.stringify(n));
  }
  assert.equal(classifyUkNumber(null), "unknown");
  assert.equal(classifyUkNumber(undefined), "unknown");
  // 077 is a mobile, 070 and 076 are not: the boundary is exact.
  assert.equal(classifyUkNumber("07700 900123"), "mobile");
  assert.equal(classifyUkNumber("07100 900123"), "mobile");
  assert.equal(classifyUkNumber("07900 900123"), "mobile");
});

test("contact phones: a mobile in the Phone cell moves to mobile; a landline in the Mobile cell moves to phone", () => {
  const a = routeContactPhones("07700 900123", "");
  assert.deepEqual([a.phone, a.mobile, a.phoneToMobile], [null, "07700 900123", true]);
  const b = routeContactPhones("", "020 7946 0018");
  assert.deepEqual([b.phone, b.mobile, b.mobileToPhone], ["020 7946 0018", null, true]);
  // Both in the wrong columns: swapped.
  const c = routeContactPhones("07700 900123", "020 7946 0018");
  assert.deepEqual([c.phone, c.mobile], ["020 7946 0018", "07700 900123"]);
  assert.deepEqual([c.phoneToMobile, c.mobileToPhone], [true, true]);
});

test("contact phones: right numbers in the right columns stay put; unknown numbers stay where they came from", () => {
  const ok = routeContactPhones("020 7946 0018", "07700 900123");
  assert.deepEqual([ok.phone, ok.mobile, ok.phoneToMobile, ok.mobileToPhone], ["020 7946 0018", "07700 900123", false, false]);
  const unk = routeContactPhones("0800 123 4567", "");
  assert.deepEqual([unk.phone, unk.mobile], ["0800 123 4567", null]);
  const unkMob = routeContactPhones("", "0800 123 4567");
  assert.deepEqual([unkMob.phone, unkMob.mobile], [null, "0800 123 4567"]);
  const none = routeContactPhones("", "  ");
  assert.deepEqual([none.phone, none.mobile], [null, null]);
});

test("contact phones: two numbers of the same kind stay in their own columns as exported, and are flagged", () => {
  const two = routeContactPhones("07700 900123", "07700 900456");
  assert.deepEqual([two.phone, two.mobile, two.sameClass], ["07700 900123", "07700 900456", "mobile"]);
  const land = routeContactPhones("020 7946 0018", "020 7946 0019");
  assert.deepEqual([land.phone, land.mobile, land.sameClass], ["020 7946 0018", "020 7946 0019", "landline"]);
  // A mobile in Phone beside an unreadable number in Mobile: no move, no loss, no flag.
  const clash = routeContactPhones("07700 900123", "0800 123 4567");
  assert.deepEqual([clash.phone, clash.mobile, clash.sameClass], ["07700 900123", "0800 123 4567", null]);
});

test("company phones: one field, so the landline (else the first) is the phone and every other number goes to notes", () => {
  const a = planCompanyPhones(["07700 900123", "020 7946 0018"]);
  assert.equal(a.phone, "020 7946 0018");
  assert.deepEqual(a.extraLines, ["Mobile (as exported): 07700 900123"]);
  const b = planCompanyPhones(["020 7946 0018", "07700 900123"]);
  assert.equal(b.phone, "020 7946 0018");
  assert.deepEqual(b.extraLines, ["Mobile (as exported): 07700 900123"]);
  const two = planCompanyPhones(["07700 900123", "07700 900456"]);
  assert.equal(two.phone, "07700 900123");
  assert.deepEqual(two.extraLines, ["Mobile (as exported): 07700 900456"]);
  const other = planCompanyPhones(["020 7946 0018", "0800 123 4567"]);
  assert.deepEqual(other.extraLines, ["Phone (as exported): 0800 123 4567"]);
  // The same number twice (spacing aside) is one number; nothing to keep.
  const same = planCompanyPhones(["020 7946 0018", "020  7946 0018"]);
  assert.deepEqual([same.phone, same.extraLines], ["020 7946 0018", []]);
  assert.deepEqual(planCompanyPhones([]), { phone: null, extraLines: [] });
  // The lines go into notes through mergeNotes without touching what is stored.
  assert.equal(mergeNotes("Existing note", a.extraLines.join("\n")), "Existing note\n\nMobile (as exported): 07700 900123");
});

// ---------------------------------------------------------------- tenant

test("tenant: company before the bracket, person inside", () => {
  assert.deepEqual(parseTenant("Acme Ltd (Mr First Last)"), {
    shape: "bracket",
    companyName: "Acme Ltd",
    person: "Mr First Last",
  });
  assert.equal(parseTenant("  Acme Ltd   (Ms Jo Bloggs)  ").companyName, "Acme Ltd");
  assert.equal(parseTenant("Acme (UK) Ltd (Mr A B)").companyName, "Acme (UK) Ltd");
});

test("tenant: plain, unknown and empty", () => {
  assert.deepEqual(parseTenant("Acme Ltd"), { shape: "plain", companyName: "Acme Ltd", person: null });
  assert.equal(parseTenant("Unknown").shape, "unknown");
  assert.equal(parseTenant("  UNKNOWN ").companyName, null);
  assert.equal(parseTenant("").shape, "empty");
  assert.equal(parseTenant(null).shape, "empty");
  // A bracket with nothing before it is not a company.
  assert.equal(parseTenant("(Mr A B)").shape, "plain");
});

// ---------------------------------------------------------------- reference

const KATO: LegacyRowCells = {
  title: "Acme Ltd (Mr A B)",
  size: "1,000 to 4,000 sq ft",
  propertyType: "Restaurant",
  rent: "Up to £100,000 per annum",
  area: "Zone 1, W1",
  email: "a@b.co",
};

test("legacyRowRef: stable across whitespace and case, sensitive to content", () => {
  const ref = legacyRowRef(KATO);
  assert.match(ref, /^kato-[0-9a-f]{16}$/);
  const shouty = Object.fromEntries(
    Object.entries(KATO).map(([k, v]) => [k, `  ${v.toUpperCase()}  `]),
  ) as LegacyRowCells;
  assert.equal(legacyRowRef(shouty), ref, "case and outer whitespace must not matter");
  const spaced = Object.fromEntries(
    Object.entries(KATO).map(([k, v]) => [k, v.replace(/ /g, "   ")]),
  ) as LegacyRowCells;
  assert.equal(legacyRowRef(spaced), ref, "inner whitespace runs must not matter");
  for (const k of Object.keys(KATO) as (keyof LegacyRowCells)[]) {
    assert.notEqual(legacyRowRef({ ...KATO, [k]: KATO[k] + "x" }), ref, `${k} must change the reference`);
  }
  assert.notEqual(
    legacyRowRef({ ...KATO, title: "b", size: "a" }),
    legacyRowRef({ ...KATO, title: "a", size: "b" }),
    "the same values in different slots are a different row",
  );
});

test("legacyRowRef: digit grouping and currency signs do not change the reference", () => {
  const ref = legacyRowRef(KATO);
  assert.equal(
    legacyRowRef({ ...KATO, size: "1000 to 4000 sq ft", rent: "Up to 100000 per annum" }),
    ref,
    "1,000 and 1000, 100,000 and 100000, must hash the same",
  );
  assert.equal(legacyRowRef({ ...KATO, rent: "Up to 100,000 per annum" }), ref, "the pound sign must not matter");
  assert.notEqual(legacyRowRef({ ...KATO, rent: "Up to £100,001 per annum" }), ref, "a different figure must");
  assert.notEqual(legacyRowRef({ ...KATO, rent: "Up to £10,000 per annum" }), ref);
});

test("legacyRowRef: a missing column is an empty slot, so the shape never depends on the file", () => {
  const ref = legacyRowRef({ ...KATO, rent: "" });
  assert.equal(legacyRowRef({ ...KATO, rent: "   " }), ref);
  assert.notEqual(ref, legacyRowRef(KATO));
  // Same six slots, same order, same pipe-joined text: what the importer passes.
  assert.equal(
    ref,
    legacyRowRef({ title: KATO.title, size: KATO.size, propertyType: KATO.propertyType, rent: "", area: KATO.area, email: KATO.email }),
  );
});

test("legacyRowRef: known value, pinned, through the same call the importer makes", () => {
  assert.equal(legacyRowRef(KATO), "kato-e350fcdf98fefe54");
});

// ---------------------------------------------------------------- company type

const types = [
  { slug: "operator", label: "Operator" },
  { slug: "investor_institutional", label: "Investor (Institutional)" },
  { slug: "other", label: "Other" },
];

test("company type: first match is the type, the rest become tags", () => {
  const r = parseCompanyType(["Applicant", "Investor (Institutional)"], types);
  assert.equal(r.type, "investor_institutional");
  assert.deepEqual(r.extraTags, ["Applicant"]);
  assert.deepEqual(r.unmatched, ["Applicant"]);
});

test("company type: matches slug or label, any case", () => {
  assert.equal(parseCompanyType(["OPERATOR"], types).type, "operator");
  assert.equal(parseCompanyType(["investor (institutional)"], types).type, "investor_institutional");
  assert.equal(parseCompanyType(["investor_institutional"], types).type, "investor_institutional");
  const two = parseCompanyType(["Operator", "Other"], types);
  assert.equal(two.type, "operator");
  assert.deepEqual(two.extraTags, ["Other"]);
  assert.deepEqual(two.unmatched, []);
});

test("company type: nothing matched leaves type null and names the values", () => {
  const r = parseCompanyType(["Applicant"], types);
  assert.equal(r.type, null);
  assert.deepEqual(r.unmatched, ["Applicant"]);
  assert.deepEqual(parseCompanyType([], types), { type: null, extraTags: [], unmatched: [] });
  assert.equal(parseCompanyType(["", "  "], types).type, null);
});

test("hasLetterOrDigit rejects placeholders", () => {
  for (const bad of ["-", ".", "…", "...", "  ", "()", "--"]) assert.equal(hasLetterOrDigit(bad), false, bad);
  for (const good of ["A", "7", "Zoë", "-A-"]) assert.equal(hasLetterOrDigit(good), true, good);
});

// ---------------------------------------------------------------- reporting

test("summariseReasons groups by reason and shows counts and example rows", () => {
  const out = summariseReasons([
    "Row 5: no contact email and no matching company",
    "Row 9: no contact email and no matching company",
    'Row 12: ignored email "x" — not a valid address',
    'Row 13: ignored email "y" — not a valid address',
    'Row 14: ignored email "z" — not a valid address',
  ]);
  assert.equal(
    out,
    'ignored email "..." — not a valid address (3, e.g. rows 12, 13, 14); no contact email and no matching company (2, e.g. rows 5, 9)',
  );
  assert.equal(summariseReasons(["Row 1: a", "Row 2: b", "Row 3: c", "Row 4: d"]).endsWith("and 1 other reason(s)"), true);
});

// ---------------------------------------------------------------- csv.ts wiring

test("headers: the Kato exports resolve to the right columns", () => {
  const companies = mapHeaders("companies", [
    ["Name", "Company Type", "Domain", "Address Line 1", "Town", "Postcode", "Telephone", "Date Updated"],
  ]);
  assert.deepEqual(companies.unrecognised, []);
  assert.deepEqual(
    [...companies.columns.keys()],
    ["name", "type", "website", "address_line", "city", "postcode", "phone", "date_updated"],
  );

  const contacts = mapHeaders("contacts", [
    [
      "First Name",
      "Surname",
      "Email",
      "Company Name",
      "Phone Number",
      "Mobile Number",
      "Marketing: Latest News?",
      "Marketing: Property Alerts?",
      "Date updated",
    ],
  ]);
  assert.deepEqual(contacts.unrecognised, []);
  const keys = new Map([...contacts.columns].map(([k, v]) => [k, v[0]]));
  assert.equal(keys.get("phone"), 4);
  assert.equal(keys.get("mobile"), 5, "Mobile Number must not feed phone");
  assert.equal(keys.get("marketing_opt_in"), 6);
  assert.equal(keys.get("marketing_property_alerts"), 7);
  assert.equal(keys.get("date_updated"), 8);

  const reqs = mapHeaders("requirements", [
    ["Requirements"],
    [],
    ["Tenant", "Size", "Property Type", "Rent", "Area", "Tenant Email"],
    ["Acme Ltd", "1,000 to 4,000 sq ft", "Bar", "", "Soho", "a@b.co"],
  ]);
  assert.equal(reqs.headerRow, 2);
  assert.deepEqual(reqs.unrecognised, []);
  assert.deepEqual(
    [...reqs.columns.keys()],
    ["title", "size_text", "use_classes", "rent_text", "area_text", "contact_email"],
  );
});

test("headers: a bare Mobile column is the mobile field for contacts and the phone field for companies", () => {
  const c = mapHeaders("contacts", [["First Name", "Phone", "Mobile"]]);
  assert.deepEqual(c.columns.get("phone"), [1]);
  assert.deepEqual(c.columns.get("mobile"), [2]);
  assert.deepEqual(c.unrecognised, []);
  const k = mapHeaders("companies", [["Name", "Phone Number", "Mobile Number", "Mobile"]]);
  assert.deepEqual(k.columns.get("phone"), [1, 2, 3]);
  assert.equal(k.columns.has("mobile"), false);
});

test("anchor geocoding helpers: UK box and one key per place", () => {
  assert.equal(inUkBox(51.5, -0.12), true); // London
  assert.equal(inUkBox(57.15, -2.09), true); // Aberdeen
  assert.equal(inUkBox(48.85, 2.35), false); // Paris
  assert.equal(inUkBox(40.7, -74.0), false); // New York
  assert.equal(inUkBox(Number.NaN, 0), false);
  // The edges: 49.8 to 60.9 north, -8.7 to 1.8 east.
  assert.deepEqual(
    [inUkBox(49.7, 0), inUkBox(49.8, 0), inUkBox(60.9, 0), inUkBox(61, 0)],
    [false, true, true, false],
  );
  assert.deepEqual(
    [inUkBox(55, -8.8), inUkBox(55, -8.7), inUkBox(55, 1.8), inUkBox(55, 1.9)],
    [false, true, true, false],
  );
  assert.equal(anchorKey("  Berwick   Street "), anchorKey("berwick street"));
  assert.equal(anchorKey("King's Cross"), anchorKey("Kings Cross"));
  assert.notEqual(anchorKey("Berwick Street"), anchorKey("Berwick Road"));
  assert.equal(MAX_ANCHOR_GEOCODES, 60);
});

test("headers: date and notes synonyms", () => {
  for (const h of ["Date Updated", "Updated", "Last Updated", "Modified", "Date Modified"]) {
    assert.ok(mapHeaders("contacts", [["First Name", h]]).columns.has("date_updated"), h);
  }
  for (const h of ["Comment", "General Notes", "Internal Notes"]) {
    assert.ok(mapHeaders("companies", [["Name", h]]).columns.has("notes"), h);
  }
});

test("importFileKind accepts csv and Excel only", () => {
  assert.equal(importFileKind("a.csv"), "csv");
  assert.equal(importFileKind("A.XLSX"), "xlsx");
  assert.equal(importFileKind("a.xls"), "xlsx");
  for (const bad of ["a.pdf", "a.exe", "a", "a.csv.exe", "a.xlsm", ""]) {
    assert.equal(importFileKind(bad), null, bad);
  }
});

// ---------------------------------------------------------------- xlsx rows

test("dateCellToIso: wall-clock values, date only at midnight, seconds rounded", () => {
  assert.equal(dateCellToIso(new Date(Date.UTC(2025, 10, 4, 8, 16, 49, 999))), "2025-11-04 08:16:50");
  assert.equal(dateCellToIso(new Date(Date.UTC(2025, 10, 4))), "2025-11-04");
  assert.equal(dateCellToIso(new Date(Date.UTC(2025, 6, 1, 12, 0, 0))), "2025-07-01 12:00:00");
});

// ---------------------------------------------------------------- xlsx rows

function workbookBuffer(sheets: Record<string, XLSX.WorkSheet>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

test("workbookToRows: first sheet only, named; dates as ISO; text cells keep leading zeros; blank rows dropped", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "Telephone", "Date Updated"],
    ["Acme", "02071230000", 45839.5],
    [],
    ["Beta", "07700900000", 45965],
  ]);
  ws["C2"].z = "dd/mm/yyyy hh:mm";
  ws["C4"].z = "dd/mm/yyyy";
  const other = XLSX.utils.aoa_to_sheet([["Ignore"], ["me"]]);
  const out = workbookToRows(XLSX, workbookBuffer({ First: ws, Second: other }));
  assert.equal(out.sheetName, "First");
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.rows, [
    ["Name", "Telephone", "Date Updated"],
    ["Acme", "02071230000", "2025-07-01 12:00:00"],
    ["Beta", "07700900000", "2025-11-04"],
  ]);
  // The text cell is stored as text in the file; a numeric reading would give 2071230000.
  assert.notEqual(out.rows[1][1], "2071230000");
});

test("workbookToRows: a 12-digit numeric cell keeps every digit, never 4.4770090E+11", () => {
  const ws = XLSX.utils.aoa_to_sheet([["Phone", "Company number"], [447700900000, 123456789012]]);
  assert.equal(ws["A2"].t, "n"); // really a number cell, not a string
  assert.equal(Number.isInteger(ws["A2"].v), true);
  const out = workbookToRows(XLSX, workbookBuffer({ S: ws }));
  assert.deepEqual(out.rows[1], ["447700900000", "123456789012"]);
});

test("cellText: General-format integers use the stored value; formatted and fractional numbers keep their display", () => {
  assert.equal(cellText({ t: "n", v: 447700900000, w: "4.4770E+11" }), "447700900000");
  assert.equal(cellText({ t: "n", v: 447700900000, z: "General", w: "4.4770E+11" }), "447700900000");
  assert.equal(cellText({ t: "n", v: 1234, z: "0.00", w: "1234.00" }), "1234.00");
  assert.equal(cellText({ t: "n", v: 12.5, w: "12.5" }), "12.5");
  assert.equal(cellText({ t: "s", v: "007", w: "007" }), "007");
  assert.equal(cellText(undefined), "");
  // The old reading (formatted text only) would have produced the exponent form.
  assert.notEqual(cellText({ t: "n", v: 447700900000, w: "4.4770E+11" }), "4.4770E+11");
});

test("workbookToRows: too many columns or rows is an error, never a partial read", () => {
  const wide = XLSX.utils.aoa_to_sheet([["a"]]);
  wide["!ref"] = `A1:${XLSX.utils.encode_col(MAX_SHEET_COLS)}1`; // one column over the limit
  assert.throws(() => workbookToRows(XLSX, workbookBuffer({ S: wide })), WorkbookError);
  const tall = XLSX.utils.aoa_to_sheet([["a"]]);
  tall["!ref"] = `A1:A${MAX_SHEET_ROWS + 1}`;
  assert.throws(() => workbookToRows(XLSX, workbookBuffer({ S: tall })), /too large/);
  const fine = XLSX.utils.aoa_to_sheet([["a"]]);
  fine["!ref"] = `A1:${XLSX.utils.encode_col(MAX_SHEET_COLS - 1)}1`; // exactly at the limit
  assert.equal(workbookToRows(XLSX, workbookBuffer({ S: fine })).rows.length, 1);
});

test("workbookToRows: an empty sheet and a workbook with no sheet are errors", () => {
  const empty = XLSX.utils.aoa_to_sheet([[], []]);
  assert.throws(() => workbookToRows(XLSX, workbookBuffer({ S: empty })), /no rows|no sheet/);
});

test("workbookToRows: merged ranges spanning more than one row are warned about", () => {
  const ws = XLSX.utils.aoa_to_sheet([["a", "b"], ["x", "y"], ["z", ""]]);
  ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
  const out = workbookToRows(XLSX, workbookBuffer({ S: ws }));
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /merged range/);
  const flat = XLSX.utils.aoa_to_sheet([["a", "b"], ["x", "y"]]);
  flat["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]; // a one-row banner merge is fine
  assert.deepEqual(workbookToRows(XLSX, workbookBuffer({ S: flat })).warnings, []);
});

// ---------------------------------------------------------------- csv writing

test("toCsv quotes a cell containing a lone carriage return, and it reads back intact", () => {
  const text = toCsv(["a", "b"], [["x\ry", "plain"], ["l1\nl2", 'q"q']]);
  assert.ok(text.includes('"x\ry"'), "a lone CR must be quoted");
  assert.deepEqual(parseCsv(text), [
    ["a", "b"],
    ["x\ry", "plain"],
    ["l1\nl2", 'q"q'],
  ]);
});

// ---------------------------------------------------------------- identity matching

const ex = (
  id: string,
  title: string,
  contactId: string | null,
  companyId: string | null = null,
  externalRef: string | null = null,
) => ({
  id,
  title,
  contactId,
  companyId,
  externalRef,
});
const row = (title: string, contactId: string | null, companyId: string | null = null, existingId: string | null = null) => ({
  title,
  contactId,
  companyId,
  existingId,
});

test("planAdoptions: one stored requirement and one file row with the same title and contact is adopted", () => {
  const out = planAdoptions([ex("r1", "Acme Ltd (Mr A B)", "c1")], [row("  acme LTD (mr a b) ", "c1")]);
  assert.deepEqual([...out.adopt], [[0, "r1"]]);
  assert.equal(out.ambiguous.size, 0);
});

test("planAdoptions: two stored candidates, or two file rows, is ambiguous and adopts nothing", () => {
  const twoStored = planAdoptions(
    [ex("r1", "Acme", "c1"), ex("r2", "Acme", "c1")],
    [row("Acme", "c1")],
  );
  assert.equal(twoStored.adopt.size, 0);
  assert.deepEqual([...twoStored.ambiguous], [0]);
  const twoRows = planAdoptions([ex("r1", "Acme", "c1")], [row("Acme", "c1"), row("Acme", "c1")]);
  assert.equal(twoRows.adopt.size, 0);
  assert.deepEqual([...twoRows.ambiguous].sort(), [0, 1]);
});

test("planAdoptions: a different contact, title or nothing stored is neither adopted nor ambiguous", () => {
  assert.deepEqual(planAdoptions([ex("r1", "Acme", "c1")], [row("Acme", "c2")]).adopt.size, 0);
  assert.equal(planAdoptions([ex("r1", "Acme", "c1")], [row("Acme", "c2")]).ambiguous.size, 0);
  assert.equal(planAdoptions([ex("r1", "Other", "c1")], [row("Acme", "c1")]).ambiguous.size, 0);
  assert.equal(planAdoptions([], [row("Acme", "c1")]).adopt.size, 0);
});

test("planAdoptions: with no contact the company is the identity; with neither there is none", () => {
  const out = planAdoptions([ex("r1", "Acme", null, "co1")], [row("Acme", null, "co1")]);
  assert.deepEqual([...out.adopt], [[0, "r1"]]);
  assert.equal(planAdoptions([ex("r1", "Acme", null, null)], [row("Acme", null, null)]).adopt.size, 0);
});

test("planAdoptions: a stored requirement already matched by reference is not up for adoption", () => {
  const out = planAdoptions(
    [ex("r1", "Acme", "c1")],
    [row("Acme", "c1", null, "r1"), row("Acme", "c1")],
  );
  assert.equal(out.adopt.size, 0, "r1 belongs to the first row");
  assert.equal(out.ambiguous.size, 0);
});

test("planAdoptions: one stored requirement cannot be adopted by two different file rows", () => {
  // Stored under both its contact key and its company key; row 1 uses the contact, row 2 the company.
  const out = planAdoptions(
    [ex("r1", "Acme", "C", "X")],
    [row("Acme", "C", "X"), row("Acme", null, "X")],
  );
  assert.equal(out.adopt.size, 0, "neither row may adopt r1");
  assert.deepEqual([...out.ambiguous].sort(), [0, 1]);
});

test("planAdoptions: only a null or kato- reference can be adopted; a real reference never", () => {
  const real = planAdoptions([ex("r1", "Acme", "c1", null, "REQ-1042")], [row("Acme", "c1")]);
  assert.equal(real.adopt.size, 0);
  assert.equal(real.ambiguous.size, 0, "a protected requirement is not even a candidate");
  assert.deepEqual([...planAdoptions([ex("r1", "Acme", "c1", null, "kato-9ec2322e1ca464ce")], [row("Acme", "c1")]).adopt], [[0, "r1"]]);
  assert.deepEqual([...planAdoptions([ex("r1", "Acme", "c1", null, "KATO-ABC")], [row("Acme", "c1")]).adopt], [[0, "r1"]]);
  assert.deepEqual([...planAdoptions([ex("r1", "Acme", "c1", null, null)], [row("Acme", "c1")]).adopt], [[0, "r1"]]);
  // A protected twin does not make an adoptable one ambiguous.
  const mixed = planAdoptions(
    [ex("r1", "Acme", "c1", null, "REQ-1"), ex("r2", "Acme", "c1", null, null)],
    [row("Acme", "c1")],
  );
  assert.deepEqual([...mixed.adopt], [[0, "r2"]]);
});

// ---------------------------------------------------------------- small pure helpers

test("isMoreThanADayAhead: a day of slack, no more", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  assert.equal(isMoreThanADayAhead("2026-06-02T11:59:59Z", now), false);
  assert.equal(isMoreThanADayAhead("2026-06-02T12:00:01Z", now), true);
  assert.equal(isMoreThanADayAhead("2030-01-01T00:00:00Z", now), true);
  assert.equal(isMoreThanADayAhead("2020-01-01T00:00:00Z", now), false);
});

test("unionTags: stored first, distinct, never a replacement", () => {
  assert.deepEqual(unionTags(["b", "a"], ["a", "c"]), ["b", "a", "c"]);
  assert.deepEqual(unionTags(null, ["x"]), ["x"]);
  assert.deepEqual(unionTags(["x"], null), ["x"]);
  assert.deepEqual(unionTags(["x"], []), ["x"]);
});

test("capCell: over 2,000 characters is flagged and truncated", () => {
  assert.deepEqual(capCell("abc"), { text: "abc", over: false });
  assert.equal(capCell("x".repeat(MAX_CELL_CHARS)).over, false);
  const big = capCell("x".repeat(MAX_CELL_CHARS + 1));
  assert.equal(big.over, true);
  assert.equal(big.text.length, MAX_CELL_CHARS);
});

// ---------------------------------------------------------------- hostile input

const timed = (label: string, fn: () => unknown) => {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  assert.ok(ms < 500, `${label} took ${Math.round(ms)} ms on a hostile cell`);
};

test("hostile 80,000-character cells return in well under a second from every parser", () => {
  const n = 80_000;
  const cells = [
    "9".repeat(n),
    "1,".repeat(n / 2),
    " ".repeat(n),
    "(".repeat(n),
    "x(".repeat(n / 2) + ")",
    "£" + "1".repeat(n) + "k",
    "1,000 to ".repeat(n / 9) + " sq ft",
    "Zone 1, ".repeat(n / 8),
    "within 3 miles of ".repeat(n / 18),
    "2025-11-04".repeat(n / 10),
    "01/".repeat(n / 3),
    "\t".repeat(n) + "a",
  ];
  for (const c of cells) {
    timed("parseRent", () => parseRent(c));
    timed("parseSize", () => parseSize(c));
    timed("parseArea", () => parseArea(c, catalog));
    timed("parseTenant", () => parseTenant(c));
    timed("parseSourceDate", () => parseSourceDate(c));
    timed("legacyRowRef", () => legacyRowRef({ ...KATO, title: c, rent: c, area: c }));
  }
});

test("hostile cells right at the cap (2,000 characters) are also quick, and parsed", () => {
  const c = "9".repeat(MAX_CELL_CHARS);
  timed("parseRent", () => parseRent(c));
  timed("parseSize", () => parseSize(c + " sq ft"));
  timed("parseTenant", () => parseTenant("x(".repeat(MAX_CELL_CHARS / 2) + ")"));
  timed("parseArea", () => parseArea("Zone 1, ".repeat(250), catalog));
});

test("over-cap cells are refused, not parsed: size and rent unparsed, area kept whole in notes, tenant plain", () => {
  const big = "1,000 sq ft ".repeat(300);
  assert.ok(big.length > MAX_CELL_CHARS);
  assert.equal(parseSize(big).kind, "unparsed");
  assert.equal(parseRent("£100 per annum ".repeat(200)).outcome, "unparsed");
  const area = parseArea("Zone 1, ".repeat(300), catalog);
  assert.deepEqual(area.zones, []);
  assert.ok(area.note?.startsWith("Area (as exported): Zone 1"));
  assert.equal(parseTenant("Acme (Mr A) ".repeat(300)).companyName, null);
  assert.equal(parseSourceDate("2025-11-04 ".repeat(300)).kind, "invalid");
});

test("parseTenant by position: nested, unbalanced and trailing-bracket shapes", () => {
  assert.equal(parseTenant("Acme (UK) Ltd (Mr A B)").companyName, "Acme (UK) Ltd");
  assert.equal(parseTenant("Acme (UK) Ltd (Mr A B)").person, "Mr A B");
  assert.equal(parseTenant("Acme Ltd (Mr A B").shape, "plain");
  assert.equal(parseTenant("Acme Ltd Mr A B)").shape, "plain");
  assert.equal(parseTenant("Acme (a) b)").shape, "plain");
  assert.equal(parseTenant("Acme ()").person, null);
  assert.equal(parseTenant("Acme ()").companyName, "Acme");
});

test("headers: bare 'marketing' and 'optin' no longer map to marketing consent", () => {
  const h = mapHeaders("contacts", [["First Name", "Marketing", "Opt In", "Marketing: Latest News?", "marketing_opt_in"]]);
  assert.deepEqual(h.unrecognised, ["Marketing", "Opt In"]);
  assert.deepEqual(h.columns.get("marketing_opt_in"), [3, 4]);
});

// ---------------------------------------------------------------- listings follow-up

test("collectListingIds: created then updated, de-duplicated, blanks dropped", () => {
  assert.deepEqual(collectListingIds(["a", "b", null], ["b", "c", undefined, "a"]), ["a", "b", "c"]);
  assert.deepEqual(collectListingIds([], []), []);
});

test("capList: takes the first N and counts the rest", () => {
  assert.deepEqual(capList([1, 2, 3, 4, 5], 3), { take: [1, 2, 3], remainder: 2 });
  assert.deepEqual(capList([1, 2], 5), { take: [1, 2], remainder: 0 });
  assert.deepEqual(capList([1, 2], 0), { take: [], remainder: 2 });
  const ids = Array.from({ length: 700 }, (_, i) => `id${i}`);
  const { take, remainder } = capList(ids, MAX_RESCORE_LISTINGS);
  assert.equal(take.length, 500);
  assert.equal(remainder, 200);
  assert.equal(take[0], "id0", "created listings come first, so they are scored first");
});

const EMPTY_RESULT = {
  scored: 0,
  pairsSaved: 0,
  scoringOk: true,
  notScored: 0,
  rescoreRemainder: 0,
  rescoreSkipped: false,
  geocoded: 0,
  geocodeRemainder: 0,
  geocodeNoMatch: 0,
  geocodeSaveFailed: 0,
  failures: [] as string[],
};

test("followUpSummary: says what was scored and saved, not more", () => {
  assert.equal(followUpSummary(EMPTY_RESULT), "");
  assert.equal(
    followUpSummary({ ...EMPTY_RESULT, scored: 12, pairsSaved: 30, geocoded: 3 }),
    " 3 listings geocoded; Scored 12 live listings against requirements: 30 matches saved.",
  );
  assert.ok(followUpSummary({ ...EMPTY_RESULT, scored: 1, pairsSaved: 1 }).includes("Scored 1 live listing against requirements: 1 match saved."));
});

test("followUpSummary: when matches could not be saved it warns and does not claim a score", () => {
  const out = followUpSummary({ ...EMPTY_RESULT, scored: 5, pairsSaved: 0, scoringOk: false });
  assert.ok(out.includes("Matches could not be saved. They are scored the next time a listing or requirement is saved."));
  assert.equal(out.includes("Scored 5"), false);
});

test("followUpSummary: a refresh that failed before scoring anything still warns", () => {
  const out = followUpSummary({ ...EMPTY_RESULT, scored: 0, pairsSaved: 0, scoringOk: false });
  assert.ok(out.includes("Matches could not be saved."));
});

test("followUpSummary: no warning when no refresh failed", () => {
  assert.equal(followUpSummary(EMPTY_RESULT).includes("Matches could not be saved."), false);
});

test("followUpSummary: dead stock is reported separately; leftovers use the right advice", () => {
  const out = followUpSummary({
    ...EMPTY_RESULT,
    notScored: 4,
    geocodeRemainder: 7,
    rescoreRemainder: 20,
  });
  assert.ok(out.includes("4 let, sold or withdrawn listings not scored"));
  assert.ok(out.includes("7 listings still need coordinates. Open each listing and save it, or import the file again only if every row has an external_ref."));
  assert.ok(out.includes("20 listings were not re-scored (limit 500 per import). They are scored the next time the listing or a requirement is saved."));
  assert.equal(out.includes("Run Resync"), false, "Resync is not the fix for imported rows");
  assert.ok(followUpSummary({ ...EMPTY_RESULT, geocodeRemainder: 1 }).includes("1 listing still needs coordinates"));
});

test("followUpSummary: geocoder misses and save failures are separate counts", () => {
  const out = followUpSummary({ ...EMPTY_RESULT, geocodeNoMatch: 2, geocodeSaveFailed: 3 });
  assert.ok(out.includes("2 not found by the geocoder (no match for the address)"));
  assert.ok(out.includes("3 found but the coordinates could not be saved"));
  assert.ok(followUpSummary({ ...EMPTY_RESULT, rescoreSkipped: true, rescoreRemainder: 9 }).includes("Re-scoring was skipped (the import ran out of time)."));
  assert.ok(followUpSummary({ ...EMPTY_RESULT, failures: ["x"] }).includes("Follow-up problems: x."));
});

test("dryRunFollowUp: would re-score N, M need coordinates; nothing when no listings", () => {
  assert.equal(dryRunFollowUp(0, 0), "");
  assert.equal(dryRunFollowUp(5, 2), " Would re-score 5 listings, 2 need coordinates.");
  assert.equal(dryRunFollowUp(1, 1), " Would re-score 1 listing, 1 needs coordinates.");
  assert.equal(dryRunFollowUp(520, 0), " Would re-score 500 listings (20 more over the limit), 0 need coordinates.");
});

test("geocodeWindow: skipped after 70 s; otherwise 45 s, never past 85 s in total", () => {
  assert.deepEqual(geocodeWindow(0), { run: true, budgetMs: 45_000 });
  assert.deepEqual(geocodeWindow(30_000), { run: true, budgetMs: 45_000 });
  assert.deepEqual(geocodeWindow(40_000), { run: true, budgetMs: 45_000 });
  assert.deepEqual(geocodeWindow(50_000), { run: true, budgetMs: 35_000 });
  assert.deepEqual(geocodeWindow(70_000), { run: true, budgetMs: 15_000 });
  assert.equal(geocodeWindow(70_001).run, false);
  assert.equal(geocodeWindow(70_001).budgetMs, 0);
  assert.equal(geocodeWindow(120_000).run, false);
});

test("shouldRescore: allowed up to 90 s, skipped after", () => {
  assert.equal(shouldRescore(0), true);
  assert.equal(shouldRescore(90_000), true);
  assert.equal(shouldRescore(90_001), false);
});

test("chunk: one chunk for a small batch, 2,000 per chunk otherwise, order kept", () => {
  assert.deepEqual(chunk([1, 2, 3], UPSERT_CHUNK), [[1, 2, 3]]);
  assert.deepEqual(chunk([], UPSERT_CHUNK), []);
  const big = Array.from({ length: 4_001 }, (_, i) => i);
  const parts = chunk(big, UPSERT_CHUNK);
  assert.deepEqual(parts.map((x) => x.length), [2000, 2000, 1]);
  assert.equal(parts[1][0], 2000);
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test("addressChanged: only a supplied, different address part counts", () => {
  const stored = { address_line: "12 Dean St", area: "Soho", city: "London", county: "Greater London", postcode: "W1D 4SB" };
  assert.equal(addressChanged(stored, { address_line: "14 Dean St" }), true);
  assert.equal(addressChanged(stored, { postcode: "W1D 3QF" }), true);
  assert.equal(addressChanged(stored, { city: "Leeds" }), true);
  // Unchanged, blank, or missing cells leave the coordinates alone.
  assert.equal(addressChanged(stored, { address_line: "12 Dean St", city: "london" }), false);
  assert.equal(addressChanged(stored, { address_line: "  12 dean st  " }), false);
  assert.equal(addressChanged(stored, { address_line: null, area: "", postcode: "   " }), false);
  assert.equal(addressChanged(stored, {}), false);
  // A part the stored row lacks, now supplied, is a change.
  assert.equal(addressChanged({ ...stored, area: null }, { area: "Soho" }), true);
});

// ── review fixes: rent with two figures, overflow, long chains ────────────────

test("a cell with both a monthly and a yearly figure takes the yearly one", () => {
  const a = parseRent("£2,000 pcm (£24,000 pa)");
  assert.equal(a.maxRent, 24000);
  assert.equal(a.outcome, "converted");
  const b = parseRent("£24,000 per annum / £2,000 pcm");
  assert.equal(b.maxRent, 24000);
  // A monthly figure alone is still x12.
  assert.equal(parseRent("£2,000 pcm").maxRent, 24000);
});

test("a converted rent that would overflow numeric(12,2) stays in notes", () => {
  const a = parseRent("£99,999,999,999 pcm");
  assert.equal(a.maxRent, null);
  assert.ok(a.note);
  const b = parseRent("£99,999,999,999 per week");
  assert.equal(b.maxRent, null);
  assert.equal(parseRent("£2,000,000,000 pa").maxRent, null);
  assert.equal(parseRent("2000000000").maxRent, null);
  // A big but valid figure still converts.
  assert.equal(parseRent("£5,000,000 pa").maxRent, 5000000);
});

test("a long and/or chain in an area cell is left whole and fast", () => {
  // 330 pieces is about 1,980 characters: just under MAX_CELL_CHARS, so the cell
  // is parsed (a longer one is refused before it gets here).
  const cell = Array.from({ length: 330 }, () => "x").join(" and ");
  assert.ok(cell.length <= MAX_CELL_CHARS);
  const t0 = Date.now();
  const r = parseArea(cell, catalog);
  assert.ok(Date.now() - t0 < 150, "must not take cubic time");
  assert.equal(r.neighbourhoods.length + r.towns.length + r.districts.length, 0);
  // A short chain still splits.
  assert.ok(parseArea("Soho and Mayfair", catalog).neighbourhoods.length >= 1);
});
