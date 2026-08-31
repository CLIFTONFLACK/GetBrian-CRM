/**
 * Shared plumbing for the Market Intel partner scrapers.
 *
 * Every partner site is a different CMS (WordPress, Concrete, Wix, Next.js …),
 * so the per-source modules own their own selectors. What they all need is the
 * same: a browser-ish fetch, HTML → text, UK postcode/town teasing, and a few
 * entity/obfuscation quirks. That lives here so nine scrapers don't carry nine
 * copies of it.
 *
 * Deliberately free of Next.js/DB imports — these run in Server Actions and in
 * plain `node scripts/*.ts` alike.
 */

import type { DisposalInsert } from "./cdg.ts";

/**
 * One entry in a partner's live book, as enumerated from its list/search pages.
 *
 * `hints` carries the fields the *card* knows but the detail page doesn't —
 * Stephen Kane prints status only on the results row, Bruce Gillingham
 * Pollard's gallery lives on the card while the detail page shows one hero.
 * The source module shallow-merges them over the detail row (nullish hints are
 * ignored), so the orchestrator stays generic.
 */
export interface IntelListing {
  url: string;
  hints?: Partial<DisposalInsert>;
}

/**
 * Merge a listing's card-derived `hints` into a scraped row.
 *
 * Hints fill gaps by default — the detail page is the better source when it has
 * the field at all. `override` names the keys where the card genuinely knows
 * better: Stephen Kane prints status only on the results row, and Bruce
 * Gillingham Pollard's card holds the whole gallery while the detail page
 * server-renders one hero.
 */
export function applyHints(
  row: DisposalInsert,
  hints: Partial<DisposalInsert> | undefined,
  override: (keyof DisposalInsert)[] = [],
): DisposalInsert {
  if (!hints) return row;
  const wins = new Set<string>(override as string[]);
  const empty = (v: unknown) =>
    v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const out = { ...row };
  for (const [key, value] of Object.entries(hints)) {
    if (empty(value)) continue;
    if (wins.has(key) || empty((out as Record<string, unknown>)[key])) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120 Safari/537.36";

/**
 * Full or outward-only UK postcode: [outward, inward?].
 *
 * The outward half follows the Royal Mail spec rather than a loose
 * `[A-Z]{1,2}\d`: single-letter areas are only B/E/G/L/M/N/S/W, so prose like
 * "F1 Arcade" or "D2 use" can't masquerade as a district. Getting this wrong
 * stamps a wrong postcode on a listing, which then geocodes to the wrong pin.
 */
export const UK_POSTCODE =
  /\b([BEGLMNSW]\d{1,2}[A-Z]?|[A-PR-UWYZ][A-HK-Y]\d{1,2}[A-Z]?)\s*(\d[A-Z]{2})?\b/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  pound: "£",
  euro: "€",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  times: "×",
  deg: "°",
  sup2: "²",
  frac12: "½",
};

/** `&#8217;` / `&#x2019;` / `&amp;` → the character. Unknown names pass through. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * HTML fragment → plain text: `<br>`/`</p>`/`</li>` become newlines, remaining
 * tags are dropped, then entities are decoded.
 *
 * Tags are stripped *before* entities so an encoded `&#60;` can never
 * reconstitute into markup that the strip pass has already run past.
 */
export function htmlToText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/(?:\r\n|\r)/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Single-line variant — for titles and labelled values. */
export function htmlToLine(fragment: string): string {
  return htmlToText(fragment).replace(/\s*\n\s*/g, " ").trim();
}

/** Strip `<script>`/`<style>`/`<svg>` blocks before any content matching. */
export function stripNoise(html: string): string {
  return html.replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}

export interface FetchInit {
  signal?: AbortSignal;
  userAgent?: string;
  timeoutMs?: number;
}

/**
 * GET a page as text with a desktop UA and a hard timeout.
 *
 * The Accept headers are not decoration: several partner sites sit behind a
 * WAF that 403s a request carrying fetch's default catch-all Accept header
 * even with a browser User-Agent (MKR does), so we send what a browser sends.
 */
export async function fetchHtml(url: string, init?: FetchInit): Promise<string> {
  const timeout = AbortSignal.timeout(init?.timeoutMs ?? 20_000);
  const res = await fetch(url, {
    headers: {
      "User-Agent": init?.userAgent ?? DEFAULT_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      "Upgrade-Insecure-Requests": "1",
    },
    redirect: "follow",
    signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  if (!res.ok) {
    throw new ScrapeError(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.text();
}

/**
 * Best full postcode in `text`, falling back to the first outward-only district
 * ("W1"). Returns null when the copy carries neither.
 *
 * Pass `fullOnly` when scanning marketing prose rather than an address line: a
 * bare district lifted out of a paragraph is as likely to be a nearby occupier
 * or a use class as it is the subject property's own postcode.
 */
export function extractPostcode(
  text: string | null | undefined,
  opts?: { fullOnly?: boolean },
): string | null {
  if (!text) return null;
  const matches = [...text.matchAll(new RegExp(UK_POSTCODE, "g"))];
  const best = matches.find((m) => m[2]) ?? (opts?.fullOnly ? undefined : matches[0]);
  if (!best) return null;
  return [best[1], best[2]].filter(Boolean).join(" ");
}

/**
 * The last £ figure on the first line matching `label`.
 *
 * Rates lines routinely carry the UBR multiplier before the bill —
 * "Rates payable (UBR multiplier: £0.584): £88,184" — so a first-match read
 * returns 0. The figure being labelled is always the last one on the line.
 */
export function moneyOnLine(
  text: string | null | undefined,
  label: RegExp,
): number | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    if (!label.test(line)) continue;
    const amounts = [...line.matchAll(/£\s?([\d,]+(?:\.\d+)?)/g)];
    if (amounts.length === 0) continue;
    const value = Number(amounts[amounts.length - 1][1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * Normalise a town so the Listings facet doesn't split one place across two
 * buckets. Agents who headline in capitals ("LONDON") would otherwise sit
 * beside everyone else's "London" as a separate option.
 */
export function normaliseTown(town: string | null | undefined): string | null {
  const t = (town ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/[a-z]/.test(t)) return t; // already mixed case — leave the agent's spelling
  return t
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, c) => `${sep}${c.toUpperCase()}`);
}

/** Inner-London postcode areas — outer ones (BR, KT, TW …) name real towns. */
const LONDON_AREAS = /^(EC|WC|SW|SE|NW|N|E|W)\d/i;

/** True when a postcode sits in an inner-London area ("EC4", "SW11 1HG"). */
export function isLondonPostcode(postcode: string | null | undefined): boolean {
  return Boolean(postcode && LONDON_AREAS.test(postcode.trim()));
}

/**
 * Split an agent's "Address, Area, Town, POSTCODE" headline into the parts the
 * `disposals` row wants. The last comma-part that isn't a postcode is treated
 * as the town — which is how every partner writes these headlines.
 *
 * When the headline is only "1 Ludgate Circus, EC4" there is no town part left
 * after the postcode is removed, so an inner-London district resolves to
 * London: the Listings town facet and heat-map key off `city`, and dropping
 * these to null would hide half the West End book behind a "—" bucket.
 */
export function splitAddressTitle(title: string): {
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
} {
  const parts = title
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const postcode = extractPostcode(title);
  const named = parts
    .slice(1)
    .map((p) => p.replace(new RegExp(UK_POSTCODE, "g"), "").trim())
    .filter(Boolean)
    .pop();
  const city =
    named ?? (/london/i.test(title) || isLondonPostcode(postcode) ? "London" : null);
  return { addressLine: parts[0] ?? null, city, postcode };
}

/**
 * Rent period for a rent line. "On application" carries no period, so only
 * default to "per annum" when the line actually names a figure.
 */
export function rentPeriodFor(
  rentText: string | null | undefined,
  parsed: number | null,
): string | null {
  if (!rentText) return null;
  // `pa`-style tokens need the trailing guard or "Passing" reads as "Pa".
  const explicit = rentText.match(
    /per\s+(?:annum|week|month|sq\s*ft)|p\.?a\.?x?\.?(?![a-z])|pcm|pw/i,
  );
  if (explicit) return explicit[0].trim();
  return parsed != null ? "per annum" : null;
}

/**
 * Decode a Cloudflare "email protection" payload — the hex string in
 * `data-cfemail` / `#…` on `/cdn-cgi/l/email-protection` links. Byte 0 is the
 * XOR key for the rest. Used by Stephen Kane's site, which serves every agent
 * address this way.
 */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : null;
}

/** First UK-looking phone number in a blob, normalised to single spaces. */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:\+44\s?|0)(?:\d[\d\s()-]{8,14}\d)/);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** Resolve a possibly-relative href against `base`; null if unparseable. */
export function absoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Dedupe while preserving order. */
export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared field heuristics — the partner sites all express these in free copy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total square footage from a size line. Ranges ("237 to 414 sq ft") describe a
 * unit that can be split, so the upper bound is the whole-unit figure; that's
 * what `size_sqft` means everywhere else in the CRM.
 */
export function parseSizeSqft(text: string | null | undefined): number | null {
  if (!text) return null;
  // Only figures actually carrying the unit count. Anything looser reads
  // "0.11 Ac Investment for sale" as 0.11 sq ft, or a cover count as an area.
  const numbers = [...text.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*sq\.?\s*ft/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

/**
 * Sum of every "N sq ft" figure in a size line.
 *
 * Right when the line is a floor breakdown ("314 sq ft ground floor and 353 sq
 * ft basement"); wrong when it is a range, so callers must check for range
 * wording first and fall back to `parseSizeSqft`.
 */
export function sumSizeSqft(text: string | null | undefined): number | null {
  if (!text) return null;
  const figures = [...text.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*sq\.?\s*ft/gi)].map(
    (m) => Number(m[1]),
  );
  if (figures.length === 0) return null;
  const total = figures.reduce((a, b) => a + b, 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** Square metres from a size line ("342.72 sq m"). */
export function parseSizeSqm(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*sq\.?\s*m/i);
  return m ? Number(m[1]) : null;
}

export type DisposalTypeGuess =
  | "freehold"
  | "new_lease"
  | "lease_assignment"
  | "sublease"
  | "unknown";

/** Tenure wording → the CRM's disposal_type. Most specific wins. */
export function deriveDisposalType(...texts: (string | null | undefined)[]): DisposalTypeGuess {
  const blob = texts.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return "unknown";
  if (/assign(ment|ed)?\b|lease for sale|lease sale/.test(blob)) return "lease_assignment";
  if (/sub-?le(t|ase)/.test(blob)) return "sublease";
  if (/freehold|virtual freehold|long leasehold/.test(blob)) return "freehold";
  if (/new lease|to let|to-let|for rent|leasehold|new letting/.test(blob)) return "new_lease";
  return "unknown";
}

/**
 * Disposal type reconciled against what the listing is actually offering.
 *
 * Tenure prose describes the *landlord's* interest as often as the deal on
 * offer — "The property is held freehold … available to let on a new free of
 * tie lease" would otherwise import a pub-to-let as a freehold sale. The
 * search or page the row came from knows the intent; the copy only refines it.
 */
export function resolveDisposalType(
  intent: "to-let" | "for-sale",
  ...texts: (string | null | undefined)[]
): DisposalTypeGuess {
  const guess = deriveDisposalType(...texts);
  if (intent === "for-sale") {
    return guess === "unknown" || guess === "new_lease" ? "freehold" : guess;
  }
  return guess === "lease_assignment" || guess === "sublease" ? guess : "new_lease";
}

/** "Fully fitted" / "part fitted" / "shell" from marketing copy. */
export function deriveFitOut(
  ...texts: (string | null | undefined)[]
): "fully_fitted" | "part_fitted" | "shell" | null {
  const blob = texts.filter(Boolean).join(" ").toLowerCase();
  if (/shell|stripped\s+back|bare/.test(blob)) return "shell";
  if (/part(?:ially)?[- ]?fitted/.test(blob)) return "part_fitted";
  if (/fully\s+fitted|fitted\s+out|turn[- ]?key/.test(blob)) return "fully_fitted";
  return null;
}

/**
 * Partner status wording → the CRM's five canonical statuses. Anything we don't
 * recognise is passed through verbatim (the Listings page has an "Other" tile
 * for exactly that) and blank/absent means the stock is live.
 */
export function normaliseStatus(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "Available";
  const l = t.toLowerCase();
  if (/under\s*offer|sold\s*stc|let\s*agreed|sale\s*agreed/.test(l)) return "Under Offer";
  if (/\blet\b|leased|rented/.test(l)) return "Let";
  if (/\bsold\b|completed/.test(l)) return "Sold";
  if (/withdrawn|off\s*market/.test(l)) return "Withdrawn";
  if (/available|new|for\s*(sale|rent|lease)|to\s*(let|rent)|active/.test(l)) return "Available";
  return t;
}

/**
 * Pull a leading status flag off a headline. Several partners write the state
 * into the title itself, with whatever emphasis their CMS allows:
 * "Under Offer – Weybridge Hall KT13 8DX", "** SOLD ** BREWER STREET, SOHO",
 * "[LET] 12 High Street".
 */
export function splitStatusPrefix(title: string): { title: string; status: string } {
  // The flag has to be *marked* — wrapped in emphasis or followed by a dash.
  // A bare leading word is not enough: "Sold Out Bar, E1" and "Let Us Help
  // You, W1" are property names, not statuses.
  const WORDS = "under\\s+offer|sold\\s+stc|let\\s+agreed|sale\\s+agreed|withdrawn|sold|let";
  const m = title.match(
    new RegExp(
      `^\\s*(?:[*[(]+\\s*(${WORDS})\\s*[*\\])]+\\s*[-–—:|]?\\s*|(${WORDS})\\s*[-–—:|]\\s*)(.+)$`,
      "i",
    ),
  );
  if (!m || !m[3].trim()) return { title: title.trim(), status: "Available" };
  return { title: m[3].trim(), status: normaliseStatus(m[1] ?? m[2]) };
}

/**
 * Run `fn` over `items` with a fixed-size worker pool.
 *
 * Lives here rather than in the registry so scrapers can parallelise their own
 * page walks without importing the module that imports them.
 */
export async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
