// Dependency-free CSV helpers for the admin bulk importer (#8). Multi-value
// cells (tags, towns) use ";" inside the cell so they don't clash with the
// "," column delimiter.

export type ImportEntity = "companies" | "contacts" | "requirements" | "listings";

/** Parse CSV text into rows of string cells (handles quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Serialise headers + rows to CSV text (used for downloadable templates). */
export function toCsv(headers: string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/**
 * Use-class cells accept ordinary words, not slugs — "Bar;Nightclub", "Hot food
 * takeaway", even "Bar / Restaurant" in one cell. The importer runs them through
 * the same parser the forms use, so nobody has to know that Nightclub is stored
 * as `sui_generis_nightclub`.
 */
const USE_CLASS_HINT =
  "Pub, Bar, Nightclub, Hot food takeaway, Café, Gym, Leisure, Restaurant, Other";

/** Column headers, one example row, and a note on the fiddly columns. */
export const IMPORT_TEMPLATES: Record<
  ImportEntity,
  { label: string; headers: string[]; example: string[]; hint: string }
> = {
  companies: {
    label: "Companies",
    // county is derived from postcode/town when left blank. Rows whose name
    // already exists (case-insensitively) are skipped on import.
    headers: [
      "name",
      "type",
      "sector_tags",
      "website",
      "phone",
      "address_line",
      "city",
      "postcode",
      "county",
      "notes",
    ],
    example: [
      "Riverside Taverns Ltd",
      "operator",
      "Pub;Bar",
      "https://example.co.uk",
      "+44 20 7123 4567",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "Key operator",
    ],
    hint: `sector_tags: ${USE_CLASS_HINT}. Anything else is kept as a free tag. county is derived from postcode/town when blank.`,
  },
  contacts: {
    label: "Contacts",
    // company_name links (or creates) the contact's company; county is derived
    // from postcode/town when left blank. Rows whose email already exists
    // (case-insensitively) are skipped on import.
    headers: [
      "first_name",
      "last_name",
      "email",
      "phone",
      "role",
      "company_name",
      "address_line",
      "city",
      "postcode",
      "county",
      "marketing_opt_in",
      "notes",
    ],
    example: [
      "James",
      "Hartley",
      "james@example.co.uk",
      "+44 7700 900000",
      "acquisitions",
      "Riverside Taverns Ltd",
      "12 Riverside Walk",
      "London",
      "SE1 9PP",
      "",
      "true",
      "Met at expo",
    ],
    hint: "company_name links (or creates) the contact's company. role must match a slug from Admin → Edit contact roles, else it falls back to Other.",
  },
  requirements: {
    label: "Requirements",
    // contact_email is REQUIRED — must match an existing contact (every requirement
    // must have a contact). Import contacts first, then reference them by email.
    headers: [
      "title",
      "contact_email",
      "status",
      "target_london_zones",
      "target_neighbourhoods",
      "target_towns",
      "target_counties",
      "target_regions",
      "target_postcode_districts",
      "use_classes",
      "tenure_prefs",
      "min_sqft",
      "max_sqft",
      "min_covers",
      "max_covers",
      "max_rent",
      "max_premium",
      "max_guide_price",
      "notes",
    ],
    example: [
      "Wet-led bar, Central London",
      "james@example.co.uk",
      "active",
      "Zone 1;Zone 2",
      "Soho;Shoreditch",
      "London",
      "Surrey;Kent",
      "Greater London",
      "W1;W2",
      "Bar;Pub",
      "leasehold",
      "1200",
      "3000",
      "40",
      "120",
      "110000",
      "50000",
      "",
      "Needs late licence",
    ],
    hint: `contact_email is required and must match an existing contact — import Contacts first. use_classes: ${USE_CLASS_HINT}. tenure_prefs: freehold, leasehold. target_london_zones: Zone 1 … Zone 9.`,
  },
  listings: {
    label: "Listings",
    // contact_email is REQUIRED — must match an existing contact (every listing
    // must have a contact). Company is optional and not set via CSV.
    //
    // `use_classes` replaced the old free-text `use_class` column: the importer
    // derives both stored fields from it, exactly as the listing form does.
    headers: [
      "title",
      "contact_email",
      "listing_type",
      "status",
      "disposal_type",
      "address_line",
      "area",
      "city",
      "county",
      "postcode",
      "use_classes",
      "size_sqft",
      "covers_internal",
      "rent_pa",
      "premium",
      "guide_price",
      "description",
    ],
    example: [
      "Corner bar, Soho",
      "james@example.co.uk",
      "cdg",
      "Available",
      "new_lease",
      "42 Dean Street",
      "Soho",
      "London",
      "Greater London",
      "W1D 4SB",
      "Bar;Nightclub",
      "1850",
      "90",
      "95000",
      "120000",
      "",
      "Prime corner unit",
    ],
    hint: `contact_email is required and must match an existing contact — import Contacts first. use_classes: ${USE_CLASS_HINT} (the planning class is derived from it). listing_type: cdg or intel. disposal_type: freehold, new_lease, lease_assignment, sublease.`,
  },
};
