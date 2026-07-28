// Typed domain -> badge tone/label maps. Single source so colour<->meaning stays
// consistent everywhere (see design-system/slc-crm/MASTER.md §2). The string unions
// here seed the Postgres enums that arrive in Phase 1.

export type BadgeTone =
  | "slate"
  | "teal"
  | "emerald"
  | "amber"
  | "sky"
  | "violet"
  | "indigo"
  | "orange"
  | "red";

export type BadgeSpec = { tone: BadgeTone; label: string };

// Company types are now editable data (Admin → "Edit company types"), so the label
// comes from the DB — pass it in. Tone is keyed off the historical slugs; custom
// types fall back to slate. The label fallbacks only apply when a slug outlives its
// row (then we title-case the slug as a last resort).
const COMPANY_TYPE_TONES: Record<string, BadgeTone> = {
  operator: "teal",
  landlord: "sky",
  agent: "violet",
  vendor: "amber",
};
const COMPANY_TYPE_FALLBACK_LABELS: Record<string, string> = {
  operator: "Operator",
  landlord: "Landlord",
  agent: "Agent",
  vendor: "Vendor",
  other: "Other",
};
export function companyTypeBadge(slug: string, label?: string): BadgeSpec {
  return {
    tone: COMPANY_TYPE_TONES[slug] ?? "slate",
    label:
      label ??
      COMPANY_TYPE_FALLBACK_LABELS[slug] ??
      (slug
        ? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "—"),
  };
}

// Contact roles are now editable data (Admin → "Edit roles"), so the label comes
// from the DB — pass it in. Tone is keyed off the historical slugs; custom roles
// fall back to slate. The label fallbacks only apply when a slug outlives its row.
const CONTACT_ROLE_TONES: Record<string, BadgeTone> = {
  acquisitions: "teal",
  landlord: "sky",
  solicitor: "violet",
  agent: "indigo",
  finance: "amber",
};
const CONTACT_ROLE_FALLBACK_LABELS: Record<string, string> = {
  acquisitions: "Acquisitions",
  landlord: "Landlord",
  solicitor: "Solicitor",
  agent: "Agent",
  finance: "Finance",
  other: "Other",
};
export function contactRoleBadge(slug: string, label?: string): BadgeSpec {
  return {
    tone: CONTACT_ROLE_TONES[slug] ?? "slate",
    label: label ?? CONTACT_ROLE_FALLBACK_LABELS[slug] ?? slug,
  };
}

export function matchScoreBadge(score: number): BadgeSpec {
  if (score >= 75) return { tone: "emerald", label: `${score}% match` };
  if (score >= 50) return { tone: "teal", label: `${score}% match` };
  if (score >= 25) return { tone: "amber", label: `${score}% match` };
  return { tone: "slate", label: `${score}% match` };
}

export function kycRiskBadge(risk: string): BadgeSpec {
  switch (risk) {
    case "low":
      return { tone: "emerald", label: "Low risk" };
    case "medium":
      return { tone: "amber", label: "Medium risk" };
    case "high":
      return { tone: "red", label: "High risk" };
    default:
      return { tone: "slate", label: "Not assessed" };
  }
}

export function requirementStatusBadge(status: string): BadgeSpec {
  switch (status) {
    case "active":
      return { tone: "emerald", label: "Active" };
    case "on_hold":
      return { tone: "amber", label: "On hold" };
    case "satisfied":
      return { tone: "sky", label: "Satisfied" };
    case "withdrawn":
      return { tone: "slate", label: "Withdrawn" };
    default:
      return { tone: "slate", label: status };
  }
}

// Every listing is either CDG's own instruction or INTEL (market intelligence).
// INTEL listings produce an unbranded PDF (no CDG branding).
export function listingTypeBadge(type: string | null | undefined): BadgeSpec {
  return type === "intel"
    ? { tone: "orange", label: "INTEL" }
    : { tone: "teal", label: "CDG" };
}

export function listingStatusBadge(status: string | null | undefined): BadgeSpec {
  const s = (status ?? "").trim();
  const k = s.toLowerCase();
  if (!k) return { tone: "slate", label: "—" };
  if (/avail/.test(k)) return { tone: "emerald", label: s };
  // "Sold STC" / "Let STC" (subject to contract) are in-play like Under Offer,
  // not terminal — test before the bare sold/let branches below.
  if (/under\s*offer|u\.?o\.?\b|sale\s*agreed|let\s*agreed|\bstc\b/.test(k))
    return { tone: "amber", label: s };
  if (/\blet\b/.test(k)) return { tone: "sky", label: s };
  if (/sold|completed/.test(k)) return { tone: "violet", label: s };
  if (/withdrawn|unavailable|under\s*review/.test(k))
    return { tone: "slate", label: s };
  return { tone: "slate", label: s };
}

// Whether a disposal is still live, pitchable supply for matching. Mirrors the
// free-text states classified by listingStatusBadge: exclude terminally-gone
// stock (let / sold / completed / withdrawn / unavailable); keep available,
// under-offer/sale-agreed (still in play as backups), and unknown/null.
export function isListingMatchable(status: string | null | undefined): boolean {
  const k = (status ?? "").trim().toLowerCase();
  if (!k) return true; // unknown — keep, don't hide supply on missing data
  if (/\bstc\b/.test(k)) return true; // subject to contract — still in play
  return !/\blet\b|sold|completed|withdrawn|unavailable/.test(k);
}

export function dealStageBadge(stage: string): BadgeSpec {
  switch (stage) {
    case "lead":
      return { tone: "slate", label: "Lead" };
    case "viewing":
      return { tone: "sky", label: "Viewing" };
    case "offer":
      return { tone: "amber", label: "Offer" };
    case "heads_of_terms":
      return { tone: "indigo", label: "Heads of Terms" };
    case "legal":
      return { tone: "violet", label: "Legal" };
    case "completed":
      return { tone: "emerald", label: "Completed" };
    case "fell_through":
      return { tone: "red", label: "Fell Through" };
    default:
      return { tone: "slate", label: stage };
  }
}

// Trading concepts (what the requirement form now offers) first, then the
// planning-class slugs kept for briefs written before migration 0034.
export function propertyUseBadge(useClass: string): BadgeSpec {
  switch (useClass) {
    case "pub":
      return { tone: "violet", label: "Pub" };
    case "bar":
      return { tone: "violet", label: "Bar" };
    case "sui_generis_nightclub":
      return { tone: "indigo", label: "Nightclub" };
    case "sui_generis_hot_food":
      return { tone: "orange", label: "Hot Food Takeaway" };
    case "cafe":
      return { tone: "amber", label: "Café" };
    case "gym":
      return { tone: "teal", label: "Gym" };
    case "leisure":
      return { tone: "sky", label: "Leisure" };
    case "restaurant":
      return { tone: "emerald", label: "Restaurant" };
    case "E":
      return { tone: "slate", label: "Class E (legacy)" };
    case "sui_generis_pub_bar":
      return { tone: "slate", label: "Pub / Bar (legacy)" };
    case "A3":
      return { tone: "slate", label: "A3 (legacy)" };
    case "A4":
      return { tone: "slate", label: "A4 (legacy)" };
    case "A5":
      return { tone: "slate", label: "A5 (legacy)" };
    case "other":
      return { tone: "slate", label: "Other" };
    default:
      return { tone: "slate", label: useClass };
  }
}

export function licenceBadge(licence: string): BadgeSpec {
  switch (licence) {
    case "held":
      return { tone: "emerald", label: "Licence Held" };
    case "late":
      return { tone: "teal", label: "Late Licence" };
    case "none":
      return { tone: "slate", label: "No Licence" };
    default:
      return { tone: "slate", label: licence };
  }
}

export function tenureBadge(tenure: string): BadgeSpec {
  switch (tenure) {
    case "freehold":
      return { tone: "emerald", label: "Freehold" };
    case "leasehold":
      return { tone: "sky", label: "Leasehold" };
    case "assignment":
      return { tone: "amber", label: "Assignment" };
    case "new_letting":
      return { tone: "teal", label: "New Letting" };
    default:
      return { tone: "slate", label: tenure };
  }
}
