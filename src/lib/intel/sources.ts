/**
 * Market Intel partner-source registry — the single place that knows which
 * external agents we scrape, how to enumerate their books, and how to label
 * them in the UI. Used by the Admin resync/delete actions, the Listings
 * "Agent" filter and Source column, and the standalone scrape scripts.
 *
 * Partner sites publish their books in two shapes, so a scraper is one of:
 *
 *  - `kind: "detail"` — a list/search page enumerates units, each with its own
 *    page. `fetchListings` returns the URLs (plus any `hints` the card carries
 *    that the detail page doesn't, such as status), `fetchDetail` maps one.
 *    The orchestrator gets per-unit retries and concurrency for free.
 *  - `kind: "list"` — everything is on the index. MKR has no detail pages at
 *    all; Savills renders each card's full record into a `__NEXT_DATA__`
 *    island, so fetching detail pages would be pure waste. One call returns
 *    every row.
 *
 * `scraper: null` means we know the agent but have nothing to scrape — Matta
 * London publishes no availabilities at all (they act for occupiers), so the
 * entry exists to show that absence rather than imply an oversight.
 */

import type { DisposalInsert } from "@/lib/disposals/cdg";
import {
  BGP_SOURCE,
  fetchAndExtractBgp,
  fetchBgpListings,
} from "@/lib/disposals/bgp";
import {
  DCL_SOURCE,
  fetchAndExtractDcl,
  fetchDclListings,
} from "@/lib/disposals/dcl";
import {
  fetchAndExtractHayHill,
  fetchHayHillListings,
  HAYHILL_SOURCE,
} from "@/lib/disposals/hayhill";
import {
  fetchAndExtractLewisCraig,
  fetchLewisCraigListingUrls,
  LEWISCRAIG_SOURCE,
} from "@/lib/disposals/lewiscraig";
import { fetchMkrDisposals, MKR_SOURCE } from "@/lib/disposals/mkr";
import {
  fetchAndExtractRestaurantProperty,
  fetchRestaurantPropertyListings,
  RESTAURANTPROPERTY_SOURCE,
} from "@/lib/disposals/restaurantproperty";
import { fetchSavillsDisposals, SAVILLS_SOURCE } from "@/lib/disposals/savills";
import {
  fetchAndExtractShelleySandzer,
  fetchShelleySandzerListingUrls,
  SHELLEYSANDZER_SOURCE,
} from "@/lib/disposals/shelleysandzer";
import {
  fetchAndExtractStephenKane,
  fetchStephenKaneListings,
  STEPHENKANE_SOURCE,
} from "@/lib/disposals/stephenkane";
import type { IntelListing } from "@/lib/disposals/scrape-utils";

export type { IntelListing };
export { pool } from "@/lib/disposals/scrape-utils";

export type IntelScraper =
  | {
      kind: "detail";
      fetchListings: () => Promise<IntelListing[]>;
      fetchDetail: (listing: IntelListing) => Promise<DisposalInsert>;
    }
  | {
      kind: "list";
      fetchAll: () => Promise<DisposalInsert[]>;
    };

export interface IntelSource {
  id: string;
  label: string;
  website: string;
  /** Null when the agent publishes no book — renders as "no public book" in Admin. */
  scraper: IntelScraper | null;
  /** Shown in Admin under the source name when the sync is deliberately narrowed. */
  note?: string;
}

export const INTEL_SOURCES: IntelSource[] = [
  {
    id: SHELLEYSANDZER_SOURCE,
    label: "Shelley Sandzer",
    website: "https://www.shelleysandzer.co.uk/",
    scraper: {
      kind: "detail",
      fetchListings: async () =>
        (await fetchShelleySandzerListingUrls()).map((url) => ({ url })),
      fetchDetail: (listing) => fetchAndExtractShelleySandzer(listing.url),
    },
  },
  {
    id: "matta",
    label: "Matta London",
    website: "https://www.matta.london/",
    scraper: null,
    note: "Acts for occupiers — publishes no availabilities to scrape.",
  },
  {
    id: RESTAURANTPROPERTY_SOURCE,
    label: "Restaurant Property",
    website: "https://www.restaurant-property.co.uk/",
    scraper: {
      kind: "detail",
      fetchListings: () => fetchRestaurantPropertyListings(),
      fetchDetail: (listing) => fetchAndExtractRestaurantProperty(listing),
    },
    note: "Named book only — their anonymous “request more info” archive carries no address or price.",
  },
  {
    id: HAYHILL_SOURCE,
    label: "Hay Hill",
    website: "https://www.hayhillpropertyservices.com/",
    scraper: {
      kind: "detail",
      fetchListings: () => fetchHayHillListings(),
      fetchDetail: (listing) => fetchAndExtractHayHill(listing),
    },
  },
  {
    id: BGP_SOURCE,
    label: "Bruce Gillingham Pollard",
    website: "https://www.brucegillinghampollard.com/",
    scraper: {
      kind: "detail",
      fetchListings: () => fetchBgpListings(),
      fetchDetail: (listing) => fetchAndExtractBgp(listing),
    },
  },
  {
    id: DCL_SOURCE,
    label: "Davis Coffer Lyons",
    website: "https://www.dcl.co.uk/",
    scraper: {
      kind: "detail",
      fetchListings: () => fetchDclListings(),
      fetchDetail: (listing) => fetchAndExtractDcl(listing),
    },
  },
  {
    id: MKR_SOURCE,
    label: "MKR Property",
    website: "https://www.mkrproperty.co.uk/",
    scraper: { kind: "list", fetchAll: () => fetchMkrDisposals() },
    note: "Their Cloudflare WAF currently refuses server-side requests — Resync will report a 403 until that changes.",
  },
  {
    id: STEPHENKANE_SOURCE,
    label: "Stephen Kane & Co",
    website: "https://stephenkane.co.uk/",
    scraper: {
      kind: "detail",
      fetchListings: () => fetchStephenKaneListings(),
      fetchDetail: (listing) => fetchAndExtractStephenKane(listing),
    },
  },
  {
    id: LEWISCRAIG_SOURCE,
    label: "Lewis Craig",
    website: "https://www.lewiscraig.co.uk/",
    scraper: {
      kind: "detail",
      fetchListings: async () =>
        (await fetchLewisCraigListingUrls()).map((url) => ({ url })),
      fetchDetail: (listing) => fetchAndExtractLewisCraig(listing.url),
    },
  },
  {
    id: SAVILLS_SOURCE,
    label: "Savills",
    website: "https://www.savills.co.uk/",
    scraper: { kind: "list", fetchAll: () => fetchSavillsDisposals() },
  },
];

export const intelSourceById = new Map(INTEL_SOURCES.map((s) => [s.id, s]));

/** Pretty label for a disposals.source value ("lewiscraig" → "Lewis Craig"). */
export function intelSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return intelSourceById.get(source)?.label ?? source;
}

/**
 * Label shown in the Listings "Agent" column and filter. Anything that isn't a
 * registered partner — manual entries, our own CDG scrape — is CDG's own book.
 */
export const OWN_BOOK_LABEL = "CDG Leisure";

export function listingAgentLabel(source: string | null | undefined): string {
  return intelSourceById.get(source ?? "")?.label ?? OWN_BOOK_LABEL;
}
