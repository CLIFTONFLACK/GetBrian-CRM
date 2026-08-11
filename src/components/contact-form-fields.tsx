"use client";

import * as React from "react";

import { AgentFields } from "@/components/agent-fields";
import { Field } from "@/components/company-form-fields";
import { Input } from "@/components/ui/input";
import { LocationSelect } from "@/components/location-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Contact } from "@/lib/db/queries/contacts";
import type { AgentOption } from "@/lib/db/queries/agencies";

/**
 * Every field of the contact record, with no `<form>` of its own — shared by
 * the full-page form at /contacts/new and the "+ New contact" modal opened from
 * a company or requirement. See {@link CompanyFormFields} for the same pattern
 * in the other direction.
 */
export function ContactFormFields({
  contact,
  agents,
  additionalAgentIds,
  roles,
  companyPicker,
  idPrefix = "",
}: {
  contact?: Contact;
  agents: AgentOption[];
  additionalAgentIds?: string[];
  roles: { slug: string; label: string }[];
  /** Company field, rendered only if supplied — omitted inside a company modal,
   *  where the company being created is the link. */
  companyPicker?: React.ReactNode;
  /** Keeps input ids unique when the fields render inside a modal over a page form. */
  idPrefix?: string;
}) {
  const c = contact;
  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" htmlFor={id("first_name")} required>
          <Input
            id={id("first_name")}
            name="first_name"
            defaultValue={c?.first_name ?? ""}
            required
          />
        </Field>
        <Field label="Last name" htmlFor={id("last_name")}>
          <Input
            id={id("last_name")}
            name="last_name"
            defaultValue={c?.last_name ?? ""}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Role" htmlFor={id("role")}>
          <Select id={id("role")} name="role" defaultValue={c?.role ?? "other"}>
            {roles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {companyPicker}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email" htmlFor={id("email")}>
          <Input id={id("email")} name="email" type="email" defaultValue={c?.email ?? ""} />
        </Field>
        <Field label="Phone" htmlFor={id("phone")}>
          <Input id={id("phone")} name="phone" type="tel" defaultValue={c?.phone ?? ""} />
        </Field>
      </div>

      <Field label="Address" htmlFor={id("address_line")}>
        <Input
          id={id("address_line")}
          name="address_line"
          placeholder="Street address"
          defaultValue={c?.address_line ?? ""}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <LocationSelect
          name="city"
          label="Town / city"
          kinds={["town"]}
          defaultValue={c?.city ?? ""}
          idPrefix={idPrefix}
        />
        <LocationSelect
          name="postcode"
          label="Postcode"
          kinds={["district"]}
          defaultValue={c?.postcode ?? ""}
          idPrefix={idPrefix}
        />
        <LocationSelect
          name="county"
          label="County"
          kinds={["county"]}
          defaultValue={c?.county ?? ""}
          hint="Auto-filled from postcode/town if left blank"
          idPrefix={idPrefix}
        />
      </div>

      <Field label="Notes" htmlFor={id("notes")}>
        <Textarea id={id("notes")} name="notes" defaultValue={c?.notes ?? ""} />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="marketing_opt_in"
          defaultChecked={c?.marketing_opt_in ?? false}
          className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
        />
        Approves receiving marketing communications
      </label>

      <AgentFields
        agents={agents}
        leadAgentId={c?.lead_agent_id}
        additionalAgentIds={additionalAgentIds}
        idPrefix={idPrefix}
      />
    </>
  );
}
