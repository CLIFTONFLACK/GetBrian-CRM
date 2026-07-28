/**
 * The leisure use classes — one source of truth for the whole app.
 *
 * Agents brief and file stock in **trading concepts** (Pub, Café, Gym), not
 * planning classes. Everything that used to be free text — a requirement's use
 * classes, a company's sector tags, a listing's property type and use class —
 * now picks from this list, so a brief and a listing can be compared directly
 * instead of hoping two people spelled "hot food takeaway" the same way.
 *
 * The `sui_generis_*` slugs are historical: those two concepts already had enum
 * values before the rest existed, and keeping them avoided rewriting live rows.
 */

import { containsWord } from "@/lib/text-match";

export type UseClassOption = readonly [slug: string, label: string];

/** The pickable list, in the order it should render. */
export const USE_CLASS_OPTIONS: readonly UseClassOption[] = [
  ["pub", "Pub"],
  ["bar", "Bar"],
  ["sui_generis_nightclub", "Nightclub"],
  ["sui_generis_hot_food", "Hot food takeaway"],
  ["cafe", "Café"],
  ["gym", "Gym"],
  ["leisure", "Leisure"],
  ["restaurant", "Restaurant"],
  ["other", "Other"],
];

const LABEL_OF = new Map(USE_CLASS_OPTIONS);

export const labelForUseClass = (slug: string): string => LABEL_OF.get(slug) ?? slug;

/**
 * Words that identify each concept in free text. Used both to score a listing
 * (see `scoreUseClass`) and to read an existing free-text value back into
 * checkboxes — a scraped "Cafe (A1) / Gym" re-opens as Café + Gym.
 */
export const USE_CLASS_CONCEPTS: Record<string, string[]> = {
  pub: ["pub", "public house", "inn", "tavern"],
  bar: ["bar", "wine bar", "cocktail bar"],
  restaurant: ["restaurant", "dining", "diner"],
  cafe: ["cafe", "coffee", "coffee shop"],
  gym: ["gym", "fitness", "health club"],
  leisure: ["leisure", "cinema", "bowling", "soft play", "entertainment"],
  sui_generis_hot_food: ["takeaway", "take away", "hot food"],
  sui_generis_nightclub: ["nightclub", "night club"],
  // Retired requirement options — still recognised on briefs written before 0034.
  sui_generis_pub_bar: ["pub", "bar", "public house"],
  other: [],
};

/** Planning classes consistent with each concept, most specific first. */
export const USE_CLASS_PLANNING: Record<string, string[]> = {
  pub: ["sui generis", "a4"],
  bar: ["sui generis", "a4"],
  restaurant: ["class e", "e", "a3"],
  cafe: ["class e", "e", "a3", "a1"],
  gym: ["class e", "e", "d2"],
  leisure: ["class e", "e", "d2", "sui generis"],
  sui_generis_hot_food: ["sui generis", "a5"],
  sui_generis_nightclub: ["sui generis"],
  sui_generis_pub_bar: ["sui generis", "a4"],
  E: ["class e", "e"],
  A3: ["a3", "class e"],
  A4: ["a4", "sui generis"],
  A5: ["a5", "sui generis"],
  other: [],
};

/** The planning class each concept actually sits in, for display/derivation. */
const PLANNING_CLASS_OF: Record<string, string> = {
  pub: "Sui Generis",
  bar: "Sui Generis",
  sui_generis_nightclub: "Sui Generis",
  sui_generis_hot_food: "Sui Generis",
  cafe: "Class E",
  gym: "Class E",
  leisure: "Class E",
  restaurant: "Class E",
};

/** Rendered before "Sui Generis" when a listing spans both. */
const PLANNING_ORDER = ["Class E", "Sui Generis"];

/** Keep a set of slugs in the canonical picker order. */
export function sortUseClasses(slugs: readonly string[]): string[] {
  const order = new Map(USE_CLASS_OPTIONS.map(([slug], i) => [slug, i]));
  return [...new Set(slugs)].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
  );
}

/**
 * Read free text back into slugs — "Bar / Pub / Restaurant" → bar, pub,
 * restaurant. Whole-word matching, so "Cafe (A1)" finds cafe and "Public house"
 * finds pub. Unrecognised text yields nothing rather than a wrong guess.
 */
export function parseUseClasses(...values: (string | null | undefined)[]): string[] {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return [];
  const hits = Object.entries(USE_CLASS_CONCEPTS)
    // sui_generis_pub_bar is a requirement-only legacy alias for pub + bar;
    // matching it here would double-count every pub.
    .filter(([slug]) => slug !== "sui_generis_pub_bar")
    .filter(([, words]) => words.some((w) => containsWord(text, w)))
    .map(([slug]) => slug);
  return sortUseClasses(hits);
}

/**
 * Split stored `sector_tags` into use-class slugs and anything the picker can't
 * express. Companies were tagged freely before this was a fixed list, so a book
 * carries "brewery" and "landlord" alongside "bar" and "pub" — the leftovers are
 * carried through the form untouched rather than destroyed on the next save.
 */
export function partitionSectorTags(tags: readonly string[]): {
  slugs: string[];
  extra: string[];
} {
  const slugs: string[] = [];
  const extra: string[] = [];
  for (const tag of tags) {
    const hits = parseUseClasses(tag);
    if (hits.length > 0) slugs.push(...hits);
    else if (tag.trim()) extra.push(tag.trim());
  }
  return { slugs: sortUseClasses(slugs), extra };
}

/** "Bar / Restaurant" — the display form a listing's `property_type` stores. */
export function formatUseClasses(slugs: readonly string[]): string {
  return sortUseClasses(slugs).map(labelForUseClass).join(" / ");
}

/**
 * The planning class implied by a set of concepts — "Sui Generis" for a pub,
 * "Class E" for a café, "Class E / Sui Generis" for a listing that's both.
 * Derived rather than typed: the planning class is a function of the trade, and
 * asking an agent for both was asking the same question twice.
 */
export function planningClassFor(slugs: readonly string[]): string | null {
  const classes = new Set(
    slugs.map((s) => PLANNING_CLASS_OF[s]).filter(Boolean) as string[],
  );
  if (classes.size === 0) return null;
  return PLANNING_ORDER.filter((c) => classes.has(c)).join(" / ");
}
