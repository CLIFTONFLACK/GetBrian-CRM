/**
 * Stephen Kane & Company (stephenkane.co.uk) → `disposals` extractor.
 *
 * WordPress running the WpResidence theme with Elementor property widgets.
 * Two passes, because the two halves of the record live in different places:
 *
 *  - Results page `/advanced-search/?filter_search_action[]=all&advanced_city=all`
 *    returns the entire book (available, let, sold and under offer) as
 *    `.row.proplist` rows. **Status, type, headline size and rent only exist
 *    here** — the detail page never prints them — so the row is carried across
 *    as `hints`. Attributes on this template are unquoted (`href=https://…`),
 *    which the patterns below allow for.
 *  - Detail page `/estate_property/<slug>/` — `h1.entry_prop`, one long
 *    `property_show_content` block written as ALL-CAPS headings (LOCATION,
 *    TERM, RENT, ACCOMMODATION, RATES …), an agent card, a Bootstrap carousel
 *    of full-size images and `#googleMap_shortcode[data-cur_lat|data-cur_long]`.
 *
 * Agent emails are served through Cloudflare's email-protection obfuscation, so
 * they come back via `decodeCfEmail`.
 */

import {
  type DisposalInsert,
  parseCovers,
  parseLease,
  parseMoney,
  parsePriceQualifier,
  parseUseClass,
} from "./cdg.ts";
import {
  type IntelListing,
  applyHints,
  decodeCfEmail,
  deriveFitOut,
  extractPhone,
  extractPostcode,
  fetchHtml,
  htmlToLine,
  htmlToText,
  moneyOnLine,
  normaliseStatus,
  parseSizeSqft,
  rentPeriodFor,
  resolveDisposalType,
  ScrapeError,
  splitAddressTitle,
  stripNoise,
  UK_POSTCODE,
  unique,
} from "./scrape-utils.ts";

export const STEPHENKANE_SOURCE = "stephenkane";
export const STEPHENKANE_BASE = "https://stephenkane.co.uk";
/** "All actions, all cities" — the whole book in one server-rendered page. */
export const STEPHENKANE_LIST_URL =
  `${STEPHENKANE_BASE}/advanced-search/?filter_search_action%5B%5D=all&advanced_city=all`;

// ─────────────────────────────────────────────────────────────────────────────
// Results page — url + the fields only the row carries.
// ─────────────────────────────────────────────────────────────────────────────

/** Text of the first element carrying `className`, tags stripped. */
function cellText(row: string, className: string): string | null {
  const m = row.match(
    new RegExp(`class=["']?${className}["']?[^>]*>([\\s\\S]*?)</div>`, "i"),
  );
  return m ? htmlToLine(m[1]) || null : null;
}

export function extractStephenKaneListings(html: string): IntelListing[] {
  const listings = new Map<string, IntelListing>();
  const rows = stripNoise(html).matchAll(
    /<div class="row proplist">([\s\S]*?)(?=<div class="row proplist">|<\/section|$)/gi,
  );
  for (const r of rows) {
    const row = r[1];
    const href = row.match(
      /class=["']?pheadlink["']?\s+href=["']?(https:\/\/stephenkane\.co\.uk\/estate_property\/[a-z0-9-]+\/)["']?/i,
    );
    if (!href) continue;

    // The city taxonomy is curated ("London EC4", "Tunbridge Wells") and beats
    // anything the headline can be made to yield: split it into the town the
    // facet wants plus the postcode district it happens to carry.
    const cityRaw = cellText(row, "cityheading") ?? "";
    const district = cityRaw.match(new RegExp(`(${UK_POSTCODE.source})$`, "i"));
    const city = cityRaw.replace(new RegExp(`\\s*${UK_POSTCODE.source}$`, "i"), "").trim();
    const address = cellText(row, "addressdiv");
    const status = row.match(/class="ribbon-inside[^"]*">([\s\S]*?)<\/div>/i);
    const type = row.match(/class="typeDetails"[\s\S]*?<b>Type<\/b>([\s\S]*?)<\/div>/i);
    const size = row.match(/class="sizeDetails"[\s\S]*?<b>Size<\/b>([\s\S]*?)<\/div>/i);
    const rent = row.match(/class="rentDetails"[\s\S]*?<b>Rent<\/b>([\s\S]*?)<\/div>/i);
    const thumb = row.match(/class=["']?propthumb["']?\s+src=["']?([^"'\s>]+)/i);

    const sizeText = size ? htmlToLine(size[1]).replace(/ft2/i, "sq ft") : null;
    const rentText = rent ? htmlToLine(rent[1]) : null;
    const rentPa = parseMoney(rentText);

    const hints: Partial<DisposalInsert> = {
      status: normaliseStatus(status ? htmlToLine(status[1]) : null),
      city: city || null,
      postcode: district ? district[1].toUpperCase() : null,
      address_line: address,
      property_type: type ? htmlToLine(type[1]) || null : null,
      size_sqft: parseSizeSqft(sizeText),
      rent_pa: rentPa,
      rent_raw: rentText || null,
      rent_period: rentPeriodFor(rentText, rentPa),
      ...(thumb ? { images: [{ url: thumb[1], alt: null }] } : {}),
    };
    listings.set(href[1], { url: href[1], hints });
  }
  return [...listings.values()];
}

export async function fetchStephenKaneListings(init?: {
  signal?: AbortSignal;
}): Promise<IntelListing[]> {
  const listings = extractStephenKaneListings(
    await fetchHtml(STEPHENKANE_LIST_URL, init),
  );
  if (listings.length === 0) {
    throw new ScrapeError(
      "No Stephen Kane listings found — the search template may have changed.",
    );
  }
  return listings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail page → DisposalInsert.
// ─────────────────────────────────────────────────────────────────────────────

/** Split the marketing prose on its ALL-CAPS headings. */
function parseCapsSections(text: string): { title: string; content: string }[] {
  const lines = text.split("\n");
  const out: { title: string; content: string }[] = [];
  let current: { title: string; content: string[] } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // A heading is short, has no lower-case letters, and holds a letter.
    const isHeading = t.length <= 40 && /[A-Z]/.test(t) && !/[a-z]/.test(t);
    if (isHeading) {
      if (current) out.push({ title: current.title, content: current.content.join("\n") });
      current = { title: t.replace(/[:\s]+$/, ""), content: [] };
    } else if (current) {
      current.content.push(t);
    }
  }
  if (current) out.push({ title: current.title, content: current.content.join("\n") });
  return out.filter((s) => s.content);
}

export function mapStephenKaneToDisposal(
  html: string,
  listing: IntelListing,
): DisposalInsert {
  const page = stripNoise(html);
  const titleMatch =
    page.match(/<h1[^>]*class="entry_prop"[^>]*>([\s\S]*?)<\/h1>/i) ??
    page.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i);
  if (!titleMatch) {
    throw new ScrapeError(`No property title found at ${listing.url}`);
  }
  const title = htmlToLine(titleMatch[1]);

  const contentMatch = page.match(
    /data-widget_type="property_show_content[^"]*"[^>]*>\s*<div class="elementor-widget-container">([\s\S]*?)<\/div>/i,
  );
  const bodyHtml = contentMatch ? contentMatch[1] : "";
  // Drop the trailing contact line — Cloudflare rewrites the address to the
  // literal "[email protected]", which is noise in a description.
  const bodyText = htmlToText(bodyHtml)
    .split("\n")
    .filter((l) => !/\[email\s*protected\]/i.test(l))
    .join("\n")
    .trim();
  const sections = parseCapsSections(bodyText);
  const section = (...names: string[]) => {
    for (const n of names) {
      const hit = sections.find((s) => s.title.toLowerCase().startsWith(n));
      if (hit) return hit.content;
    }
    return null;
  };

  // Everything before the first ALL-CAPS heading is the standfirst.
  const firstHeadingAt = sections.length
    ? bodyText.indexOf(sections[0].title)
    : -1;
  const standfirst =
    firstHeadingAt > 0 ? bodyText.slice(0, firstHeadingAt).trim() || null : null;

  const rentText = section("rent", "quoting");
  const priceText = section("price", "guide price", "premium");
  const tenureText = section("term", "tenure", "lease");
  const ratesText = section("rates");
  const accommodation = section("accommodation");

  const searchable = [title, bodyText].filter(Boolean).join("\n");

  const images = unique(
    [
      ...page.matchAll(
        /class="propery_listing_main_image[^"]*"[^>]*style="background-image:url\(([^)]+)\)/gi,
      ),
    ].map((m) => m[1].replace(/^['"]|['"]$/g, "")),
  ).map((url) => ({ url, alt: null }));

  const coords = page.match(
    /data-cur_lat="([-\d.]+)"\s+data-cur_long="([-\d.]+)"/i,
  );

  const agentBlock = page.match(
    /<div class="col-md-9 agent_details">([\s\S]*?)<\/div>\s*<div class="row custom_details_container">/i,
  );
  const agentHtml = agentBlock ? agentBlock[1] : "";
  const agentName = agentHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const agentPhoto = page.match(
    /class="agentpict"[^>]*style="background-image:url\(([^)]+)\)/i,
  );
  const cfEmail =
    agentHtml.match(/data-cfemail="([0-9a-f]+)"/i) ?? page.match(/data-cfemail="([0-9a-f]+)"/i);

  const brochure = [
    ...page.matchAll(/<a[^>]+href="(https:\/\/stephenkane\.co\.uk\/wp-content\/uploads\/[^"]+\.pdf)"/gi),
  ][0];

  const { addressLine, city, postcode } = splitAddressTitle(title);
  const rentPa = parseMoney(rentText);
  // The results row's Type column ("Freehold" / "Retail" / "Leisure") is the
  // clearest signal of what is being offered; the detail prose often never
  // says. No rent quoted is the corroborating half.
  const forSale =
    /freehold|for sale|investment/i.test(
      `${listing.hints?.property_type ?? ""} ${tenureText ?? ""} ${title}`,
    ) && rentText == null;
  const covers = parseCovers(searchable);

  return applyHints(
    {
      source: STEPHENKANE_SOURCE,
      source_ref: listing.url.replace(/\/+$/, "").split("/").pop() ?? listing.url,
      source_url: listing.url,
      status: "Available",
      source_updated_at: null,

      title,
      summary: standfirst,
      address_line: addressLine,
      area: null,
      city,
      postcode: postcode ?? extractPostcode(searchable, { fullOnly: true }),
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,

      property_type: null,
      use_class: parseUseClass(searchable),
      disposal_type: resolveDisposalType(forSale ? "for-sale" : "to-let", tenureText, searchable),
      to_let: !forSale,
      for_sale: forSale,

      rent_pa: rentPa,
      rent_raw: rentText,
      rent_period: rentPeriodFor(rentText, rentPa),
      premium: null,
      premium_raw: section("premium"),
      guide_price: parseMoney(priceText),
      price_qualifier: parsePriceQualifier(rentText, priceText),
      vat_applicable: null,
      rateable_value: moneyOnLine(ratesText, /rateable\s+value/i),
      business_rates: moneyOnLine(ratesText, /rates\s+payable/i),
      service_charge: parseMoney(section("service charge")),
      estate_charge: null,
      parking_charge: null,

      tenure_raw: tenureText,
      ...parseLease(tenureText),
      next_rent_review: null,

      size_sqft: parseSizeSqft(accommodation),
      size_sqm: null,
      covers_internal: covers.internal,
      covers_external: covers.external,
      floors: [],

      licensing_notes: section("licen"),
      fit_out_state: deriveFitOut(searchable),
      epc_rating: null,

      description: bodyText || null,
      location_description: section("location"),
      key_features: [],
      sections,

      agent_name: agentName ? htmlToLine(agentName[1]) : null,
      agent_email: cfEmail ? decodeCfEmail(cfEmail[1]) : null,
      agent_phone: extractPhone(htmlToText(agentHtml)),
      agent_photo: agentPhoto ? agentPhoto[1].replace(/^['"]|['"]$/g, "") : null,

      images,
      brochure_url: brochure ? brochure[1] : null,
    },
    listing.hints,
    ["status", "city"],
  );
}

export async function fetchAndExtractStephenKane(
  listing: IntelListing,
  init?: { signal?: AbortSignal },
): Promise<DisposalInsert> {
  return mapStephenKaneToDisposal(await fetchHtml(listing.url, init), listing);
}
