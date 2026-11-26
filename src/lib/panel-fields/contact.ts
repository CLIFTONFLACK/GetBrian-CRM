import { isValidContactEmail } from "../contact-links.ts";
import type { Registry } from "./types.ts";

/**
 * Contact fields the panel can edit one at a time. The company, the primary
 * flag, the address and the agents have their own actions.
 */
export const CONTACT_FIELDS: Registry = {
  first_name: {
    key: "first_name",
    column: "first_name",
    label: "First name",
    kind: "text",
    required: true,
    maxLength: 100,
  },
  last_name: { key: "last_name", column: "last_name", label: "Last name", kind: "text", maxLength: 100 },
  role: { key: "role", column: "role", label: "Role", kind: "select", required: true, maxLength: 80 },
  email: {
    key: "email",
    column: "email",
    label: "Email",
    kind: "email",
    maxLength: 254,
    validate: (v) =>
      v == null || (typeof v === "string" && isValidContactEmail(v))
        ? null
        : "The email address is not valid. Enter one address, for example name@company.com.",
  },
  phone: { key: "phone", column: "phone", label: "Landline", kind: "phone", maxLength: 40 },
  mobile: { key: "mobile", column: "mobile", label: "Mobile", kind: "phone", maxLength: 40 },
  notes: { key: "notes", column: "notes", label: "Summary note", kind: "textarea" },
  marketing_opt_in: {
    key: "marketing_opt_in",
    column: "marketing_opt_in",
    label: "Marketing: latest news",
    kind: "boolean",
  },
  marketing_property_alerts: {
    key: "marketing_property_alerts",
    column: "marketing_property_alerts",
    label: "Marketing: property alerts",
    kind: "boolean",
  },
};
