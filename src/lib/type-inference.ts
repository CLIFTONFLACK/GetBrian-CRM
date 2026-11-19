// Automatic company TYPE and contact ROLE, worked out from a name, a web
// address or an e-mail address.
//
// PURE FILE. It imports nothing, because the importer that will use it later
// is loaded by Node without the "@/" alias hook.
//
// HOW IT WORKS
//   1. The name is made lower case. "&" becomes "and". Punctuation becomes a
//      space. The result is split into words.
//   2. A web or e-mail address is cut down to its labels: "www" and the
//      top-level part (.com, .co.uk) are removed, then the rest is split on
//      dots and hyphens. Only the DOMAIN is read. The part of an e-mail
//      before the "@" is never read.
//   3. Each rule in the tables below is a list of words or phrases. A rule
//      matches only WHOLE words (or a whole domain label). There is no plain
//      substring match: "Highlands Pubs" does not match "land".
//   4. If different types are hit, the strongest wins. If the strongest are
//      equal and different, the answer is null. The code never guesses.
//
// To change the behaviour, change the tables. The functions need no change.

export type Strength = "strong" | "medium";

export type InferenceRule = {
  slug: string;
  strength: Strength;
  /** Whole words or phrases. Written in normal form: lower case, "and" for "&". */
  phrases: readonly string[];
  /** A hit is dropped when one of these phrases is also present (same source). */
  unless?: readonly string[];
  /** Contact rules only: read the e-mail domain, not the company name. */
  domainOnly?: boolean;
};

export type Inference = { slug: string; reason: string };

// ---------------------------------------------------------------------------
// RULE TABLES (review and change these)
// ---------------------------------------------------------------------------

/** Domains that say nothing about the business. Matched on the main label. */
export const FREE_MAIL_LABELS: readonly string[] = [
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "icloud",
  "me", "aol", "btinternet", "btconnect", "sky", "talktalk", "virginmedia",
  "proton", "protonmail",
];

export const COMPANY_TYPE_RULES: readonly InferenceRule[] = [
  // agent
  {
    slug: "agent",
    strength: "strong",
    phrases: [
      "estate agents", "chartered surveyors", "letting agents",
      "commercial property agents", "property consultants",
      // well-known UK commercial agents
      "savills", "knight frank", "cbre", "jll", "colliers",
      "cushman and wakefield", "strutt and parker", "gerald eve",
      "fisher german", "lambert smith hampton", "carter jonas",
      "bnp paribas real estate", "hartnell taylor cook", "christie and co",
      "fleurets", "vickery holman",
    ],
  },
  { slug: "agent", strength: "medium", phrases: ["surveyors", "agency"] },
  // landlord
  {
    slug: "landlord",
    strength: "strong",
    phrases: ["reit", "housing association"],
  },
  {
    slug: "landlord",
    strength: "medium",
    phrases: [
      "estates", "estate", "properties", "property holdings", "investments",
      "investment", "real estate", "trust", "developments", "developers",
      "asset management", "pension", "capital", "land holdings", "council",
      "borough",
    ],
  },
  // operator ("group" alone is NOT enough, so it is not here)
  {
    slug: "operator",
    strength: "strong",
    phrases: ["pubs", "pub company", "breweries", "brewery", "restaurants"],
  },
  {
    slug: "operator",
    strength: "medium",
    phrases: [
      "inns", "taverns", "restaurant", "bars", "bar", "cafes", "cafe",
      "coffee", "hospitality", "leisure", "gym", "gyms", "fitness", "hotels",
      "dining", "kitchen", "grill", "pizza", "burger", "bakery",
    ],
  },
];

export const CONTACT_ROLE_RULES: readonly InferenceRule[] = [
  {
    slug: "solicitor",
    strength: "strong",
    phrases: ["solicitors", "solicitor", "lawyers", "llp", "law firm"],
  },
  {
    slug: "solicitor",
    strength: "medium",
    phrases: ["law", "legal"],
    unless: ["legal and general"],
  },
  {
    slug: "finance",
    strength: "medium",
    phrases: ["finance", "bank", "lending", "capital", "funding", "mortgage"],
    domainOnly: true,
  },
];

/** Used only when no word rule fired: the role that follows the company type. */
export const CONTACT_ROLE_BY_COMPANY_TYPE: Readonly<Record<string, string>> = {
  landlord: "landlord",
  agent: "agent",
};

// ---------------------------------------------------------------------------
// Text and domain helpers
// ---------------------------------------------------------------------------

/** Lower case, accents removed, "&" to "and", punctuation to single spaces. */
export function normaliseName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameWords(raw: string | null | undefined): string[] {
  const n = normaliseName(raw);
  return n ? n.split(" ") : [];
}

// Second-level parts that sit before a two-letter country code (.co.uk).
const SECOND_LEVEL = new Set([
  "co", "org", "ac", "gov", "com", "net", "ltd", "plc", "me", "sch", "nhs",
]);

/** Host of a web address or e-mail address, or null when it is not one. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (s.startsWith("mailto:")) s = s.slice(7);
  const proto = s.indexOf("://");
  if (proto >= 0) s = s.slice(proto + 3);
  for (const sep of ["/", "?", "#"]) {
    const i = s.indexOf(sep);
    if (i >= 0) s = s.slice(0, i);
  }
  const at = s.lastIndexOf("@");
  if (at >= 0) s = s.slice(at + 1);
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  while (s.endsWith(".")) s = s.slice(0, -1);
  if (!/^[a-z0-9.-]+$/.test(s)) return null;
  if (!s.includes(".")) return null;
  return s;
}

/**
 * Labels of a host without "www" and without the top-level part.
 * "www.knight-frank.co.uk" gives ["knight-frank"]. The last label is the main one.
 */
export function domainLabels(host: string | null): string[] {
  if (!host) return [];
  const parts = host.split(".").filter(Boolean);
  if (parts[0] === "www") parts.shift();
  if (parts.length < 2) return [];
  const last = parts[parts.length - 1];
  const second = parts[parts.length - 2];
  const cut = parts.length >= 3 && last.length === 2 && SECOND_LEVEL.has(second) ? 2 : 1;
  return parts.slice(0, parts.length - cut);
}

/** True when the main label of the host is a free-mail provider. */
export function isFreeMailHost(host: string | null): boolean {
  const labels = domainLabels(host);
  if (labels.length === 0) return false;
  return FREE_MAIL_LABELS.includes(labels[labels.length - 1]);
}

type Source = "name" | "web" | "email" | "company";

type Haystack = {
  source: Source;
  words: string[];
  /** Whole domain labels (only for web and e-mail). */
  labels: string[];
};

function nameHaystack(source: "name" | "company", raw: string | null | undefined): Haystack | null {
  const words = nameWords(raw);
  return words.length ? { source, words, labels: [] } : null;
}

function domainHaystack(source: "web" | "email", raw: string | null | undefined): Haystack | null {
  const host = hostOf(raw);
  if (!host || isFreeMailHost(host)) return null;
  const labels = domainLabels(host);
  const words = labels.flatMap((l) => l.split("-")).filter(Boolean);
  return words.length ? { source, words, labels } : null;
}

function hasRun(words: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0 || run.length > words.length) return false;
  for (let i = 0; i + run.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < run.length; j++) {
      if (words[i + j] !== run[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Whole-word match; on a domain a multi-word phrase also matches one whole label. */
function phraseIn(h: Haystack, phrase: string): boolean {
  const run = nameWords(phrase);
  if (hasRun(h.words, run)) return true;
  return run.length > 1 && h.labels.includes(run.join(""));
}

function describe(h: Haystack, phrase: string): string {
  const multi = nameWords(phrase).length > 1;
  const where =
    h.source === "name" ? "name"
    : h.source === "company" ? "company name"
    : h.source === "web" ? "web domain"
    : "email domain";
  const what = multi ? "phrase" : h.source === "name" || h.source === "company" ? "word" : "label";
  return `${where} ${what} "${phrase}"`;
}

type Hit = { slug: string; strength: Strength; source: Source; reason: string };

function collectHits(rules: readonly InferenceRule[], haystacks: readonly (Haystack | null)[]): Hit[] {
  const hits: Hit[] = [];
  for (const h of haystacks) {
    if (!h) continue;
    for (const rule of rules) {
      if (rule.domainOnly && (h.source === "name" || h.source === "company")) continue;
      if (rule.unless?.some((u) => phraseIn(h, u))) continue;
      for (const phrase of rule.phrases) {
        if (phraseIn(h, phrase)) {
          hits.push({ slug: rule.slug, strength: rule.strength, source: h.source, reason: describe(h, phrase) });
        }
      }
    }
  }
  return hits;
}

type Resolution =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "hit"; slug: string; reason: string };

const kindOf = (s: Source) => (s === "name" || s === "company" ? "name" : "domain");

function resolve(hits: readonly Hit[], available: readonly string[]): Resolution {
  const ok = new Set(available);
  const bySlug = new Map<string, Hit[]>();
  for (const hit of hits) {
    if (!ok.has(hit.slug)) continue;
    const list = bySlug.get(hit.slug) ?? [];
    list.push(hit);
    bySlug.set(hit.slug, list);
  }
  if (bySlug.size === 0) return { kind: "none" };

  const scored = [...bySlug].map(([slug, list]) => {
    // Name and domain agreeing makes even a medium hit strong.
    const agree = new Set(list.map((x) => kindOf(x.source))).size >= 2;
    const score = agree || list.some((x) => x.strength === "strong") ? 2 : 1;
    return { slug, list, score };
  });
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  if (best.length > 1) return { kind: "ambiguous" };

  // One reason per source, strongest first, at most two.
  const perSource = new Map<Source, Hit>();
  for (const hit of best[0].list) {
    const cur = perSource.get(hit.source);
    if (!cur || (cur.strength === "medium" && hit.strength === "strong")) perSource.set(hit.source, hit);
  }
  const reason = [...perSource.values()]
    .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1))
    .slice(0, 2)
    .map((h) => h.reason)
    .join(" + ");
  return { kind: "hit", slug: best[0].slug, reason };
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/** Company type from name, web address and e-mail. Null when unsure. */
export function inferCompanyType(
  input: { name: string | null; website: string | null; email: string | null },
  available: readonly string[],
): Inference | null {
  const hits = collectHits(COMPANY_TYPE_RULES, [
    nameHaystack("name", input.name),
    domainHaystack("web", input.website),
    domainHaystack("email", input.email),
  ]);
  const r = resolve(hits, available);
  return r.kind === "hit" ? { slug: r.slug, reason: r.reason } : null;
}

/**
 * Contact role from the e-mail DOMAIN, the company name and the company type.
 * Contacts have no job-title column, so there is no job-title input.
 * Never guesses "acquisitions" from an operator.
 */
export function inferContactRole(
  input: { email: string | null; companyType: string | null; companyName?: string | null },
  available: readonly string[],
): Inference | null {
  const hits = collectHits(CONTACT_ROLE_RULES, [
    domainHaystack("email", input.email),
    nameHaystack("company", input.companyName),
  ]);
  const r = resolve(hits, available);
  if (r.kind === "hit") return { slug: r.slug, reason: r.reason };
  if (r.kind === "ambiguous") return null;

  const type = input.companyType;
  const slug = type ? CONTACT_ROLE_BY_COMPANY_TYPE[type] : undefined;
  if (slug && available.includes(slug)) return { slug, reason: `company type "${type}"` };
  return null;
}

// ---------------------------------------------------------------------------
// Plan helpers (pure, shared by the admin allocation and the importer)
// ---------------------------------------------------------------------------

export type PlannedChange = { id: string; slug: string; dateUpdated: string | null };

/** Splits an array into chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Groups changes by slug, in first-seen order. */
export function groupBySlug<T extends { slug: string }>(changes: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const c of changes) {
    const list = out.get(c.slug) ?? [];
    list.push(c);
    out.set(c.slug, list);
  }
  return out;
}

/** Counts per slug. */
export function countBySlug(changes: readonly { slug: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of changes) out[c.slug] = (out[c.slug] ?? 0) + 1;
  return out;
}
