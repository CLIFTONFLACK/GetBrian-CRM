"use client";

import * as React from "react";

import { AgentFields } from "@/components/agent-fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationSelect } from "@/components/location-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/database.types";
import type { AgentOption } from "@/lib/supabase/agency";

/**
 * Every field of the company record, with no `<form>` of its own — so the same
 * markup backs the full-page form at /companies/new and the "+ New company"
 * modal opened from a contact or requirement.
 *
 * The reciprocal "Add contact" picker is passed in rather than imported, which
 * keeps this module free of any dependency on the pickers that render it — and
 * lets the modal omit it entirely (the record being created there is already
 * the link, and a picker inside a picker's modal is a trap).
 */
export function CompanyFormFields({
  company,
  agents,
  additionalAgentIds,
  types = [],
  contactPicker,
  idPrefix = "",
}: {
  company?: Tables<"companies">;
  agents: AgentOption[];
  additionalAgentIds?: string[];
  types?: { slug: string; label: string }[];
  /** "Add contact" field, rendered only when creating and only if supplied. */
  contactPicker?: React.ReactNode;
  /** Keeps input ids unique when the fields render inside a modal over a page form. */
  idPrefix?: string;
}) {
  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <>
      <Field label="Company name" htmlFor={id("name")} required>
        <Input id={id("name")} name="name" defaultValue={company?.name ?? ""} required />
      </Field>

      <Field label="Type" htmlFor={id("type")}>
        <Select id={id("type")} name="type" defaultValue={company?.type ?? "operator"}>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Sector tags"
        htmlFor={id("sector_tags")}
        hint="Comma-separated, e.g. pub, bar, restaurant"
      >
        <Input
          id={id("sector_tags")}
          name="sector_tags"
          defaultValue={(company?.sector_tags ?? []).join(", ")}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Website" htmlFor={id("website")}>
          <Input
            id={id("website")}
            name="website"
            type="url"
            placeholder="https://"
            defaultValue={company?.website ?? ""}
          />
        </Field>
        <Field label="Phone" htmlFor={id("phone")}>
          <Input
            id={id("phone")}
            name="phone"
            type="tel"
            defaultValue={company?.phone ?? ""}
          />
        </Field>
      </div>

      <Field
        label="Address"
        htmlFor={id("address_line")}
        hint="Used to place the company on the map"
      >
        <Input
          id={id("address_line")}
          name="address_line"
          placeholder="Street address"
          defaultValue={company?.address_line ?? ""}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <LocationSelect
          name="city"
          label="Town / city"
          kinds={["town"]}
          defaultValue={company?.city ?? ""}
          idPrefix={idPrefix}
        />
        <LocationSelect
          name="postcode"
          label="Postcode"
          kinds={["district"]}
          defaultValue={company?.postcode ?? ""}
          idPrefix={idPrefix}
        />
        <LocationSelect
          name="county"
          label="County"
          kinds={["county"]}
          defaultValue={company?.county ?? ""}
          hint="Auto-filled from postcode/town if left blank"
          idPrefix={idPrefix}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Companies House number (CRN)"
          htmlFor={id("company_number")}
          hint="Used for KYC checks against Companies House"
        >
          <Input
            id={id("company_number")}
            name="company_number"
            placeholder="e.g. 01234567"
            defaultValue={company?.company_number ?? ""}
          />
        </Field>
        <Field label="VAT number" htmlFor={id("vat_number")}>
          <Input
            id={id("vat_number")}
            name="vat_number"
            placeholder="e.g. GB123456789"
            defaultValue={company?.vat_number ?? ""}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor={id("notes")}>
        <Textarea id={id("notes")} name="notes" defaultValue={company?.notes ?? ""} />
      </Field>

      {!company && contactPicker ? contactPicker : null}

      <AgentFields
        agents={agents}
        leadAgentId={company?.lead_agent_id}
        additionalAgentIds={additionalAgentIds}
        idPrefix={idPrefix}
      />
    </>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
