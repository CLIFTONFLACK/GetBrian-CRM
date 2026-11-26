import type { Registry } from "./types.ts";

/** Company fields the panel can edit one at a time. Address and agents have their own actions. */
export const COMPANY_FIELDS: Registry = {
  name: { key: "name", column: "name", label: "Name", kind: "text", required: true, maxLength: 200 },
  type: { key: "type", column: "type", label: "Type", kind: "select", required: true, maxLength: 80 },
  sector_tags: { key: "sector_tags", column: "sector_tags", label: "Tags", kind: "tags" },
  website: { key: "website", column: "website", label: "Website", kind: "url", maxLength: 300 },
  phone: { key: "phone", column: "phone", label: "Phone", kind: "phone", maxLength: 40 },
  company_number: {
    key: "company_number",
    column: "company_number",
    label: "Company number",
    kind: "text",
    maxLength: 20,
  },
  vat_number: {
    key: "vat_number",
    column: "vat_number",
    label: "VAT number",
    kind: "text",
    maxLength: 20,
  },
  notes: { key: "notes", column: "notes", label: "Summary note", kind: "textarea" },
};
