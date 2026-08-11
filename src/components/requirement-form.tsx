"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { AgentFields } from "@/components/agent-fields";
import {
  CompanyCreatableSelect,
  ContactCreatableSelect,
} from "@/components/creatable-select";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TargetLocationsField } from "@/components/target-locations-field";
import { UseClassCheckboxes } from "@/components/use-class-checkboxes";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/actions/types";
import type { Requirement } from "@/lib/db/queries/requirements";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

type Option = readonly [string, string];

/** Leasehold now covers assignments and new lettings alike. */
const TENURES: Option[] = [
  ["freehold", "Freehold"],
  ["leasehold", "Leasehold"],
];
const STATUSES: Option[] = [
  ["active", "Active"],
  ["on_hold", "On hold"],
  ["satisfied", "Satisfied"],
  ["withdrawn", "Withdrawn"],
];

export function RequirementForm({
  action,
  requirement,
  companies,
  contacts = [],
  companyTypes,
  defaultCompanyId,
  agents = [],
  additionalAgentIds,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  requirement?: Requirement;
  companies: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
  /** Editable company_types list — feeds the "+ New company" quick-create modal. */
  companyTypes?: { slug: string; label: string }[];
  defaultCompanyId?: string;
  agents?: AgentOption[];
  additionalAgentIds?: string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const r = requirement;

  return (
    <form action={formAction} className="space-y-6">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}

      <Section
        step={1}
        title="Brief"
        description="Who this requirement is for, and how live it is."
      >
        <Field label="Title" htmlFor="title" required>
          <Input
            id="title"
            name="title"
            defaultValue={r?.title ?? ""}
            placeholder="e.g. Wet-led bar, Central London"
            required
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <CompanyCreatableSelect
            label="Operator (company)"
            options={companies}
            defaultValue={r?.company_id ?? defaultCompanyId ?? ""}
            types={companyTypes}
          />
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={r?.status ?? "active"}>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ContactCreatableSelect
          name="contact_id"
          label="Contact"
          required
          placeholder="Select a contact…"
          options={contacts}
          defaultValue={r?.contact_id ?? ""}
          hint="Point of contact for this operator — required"
        />
      </Section>

      <Section
        step={2}
        title="Location"
        description="Where they want to trade. Matched against each listing's town, county and postcode."
      >
        <TargetLocationsField
          towns={r?.target_towns ?? []}
          regions={r?.target_regions ?? []}
          counties={r?.target_counties ?? []}
          districts={r?.target_postcode_districts ?? []}
          neighbourhoods={r?.target_neighbourhoods ?? []}
          zones={r?.target_london_zones ?? []}
        />
      </Section>

      <Section
        step={3}
        title="Property"
        description="The kind of premises they're after. Matched against each listing's type, size and covers."
      >
        <UseClassCheckboxes
          legend="Use classes"
          name="use_classes"
          selected={r?.use_classes ?? []}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberRange
            label="Size (sq ft)"
            minName="min_sqft"
            maxName="max_sqft"
            minDefault={r?.min_sqft}
            maxDefault={r?.max_sqft}
          />
          <NumberRange
            label="Covers"
            minName="min_covers"
            maxName="max_covers"
            minDefault={r?.min_covers}
            maxDefault={r?.max_covers}
          />
        </div>
      </Section>

      <Section
        step={4}
        title="Structure & budget"
        description="What they'll take on and what they'll pay. Matched against each listing's tenure and asking terms."
      >
        <CheckboxGroup
          legend="Tenure"
          name="tenure_prefs"
          options={TENURES}
          selected={r?.tenure_prefs ?? []}
        />
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Max rent (£ pa)" htmlFor="max_rent">
            <Input
              id="max_rent"
              name="max_rent"
              type="number"
              inputMode="numeric"
              defaultValue={r?.max_rent ?? ""}
            />
          </Field>
          <Field label="Max premium (£)" htmlFor="max_premium">
            <Input
              id="max_premium"
              name="max_premium"
              type="number"
              inputMode="numeric"
              defaultValue={r?.max_premium ?? ""}
            />
          </Field>
          <Field label="Max guide price (£)" htmlFor="max_guide_price" hint="Freehold budget">
            <Input
              id="max_guide_price"
              name="max_guide_price"
              type="number"
              inputMode="numeric"
              defaultValue={r?.max_guide_price ?? ""}
            />
          </Field>
        </div>
      </Section>

      <Section
        step={5}
        title="Notes & ownership"
        description="Anything the criteria above can't capture, and who's running the brief."
      >
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={r?.notes ?? ""} />
        </Field>
        <AgentFields
          agents={agents}
          leadAgentId={r?.lead_agent_id}
          additionalAgentIds={additionalAgentIds}
        />
      </Section>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : r ? "Save changes" : "Create requirement"}
        </Button>
        <Link
          href={r ? `/requirements/${r.id}` : "/requirements"}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * One numbered step of the brief: a stepper bead, a plain title, and a sentence
 * saying what the section is for and what it gets matched against. The old
 * headings crammed that into the title itself ("Location → matches disposal
 * town / county / postcode"), which read like a spec note rather than a form.
 *
 * The visible heading is a real `<h2>` (so the form has an outline) and the
 * fieldset borrows it via `aria-labelledby` — a hidden `<legend>` alongside it
 * would just make a screen reader say the title twice.
 */
function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const headingId = `req-section-${step}`;
  return (
    <fieldset
      aria-labelledby={headingId}
      className="space-y-4 border-t border-border pt-7 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary"
        >
          {step}
        </span>
        <div className="space-y-1">
          <h2 id={headingId} className="text-sm font-semibold leading-none text-foreground">
            {title}
          </h2>
          <p className="max-w-prose text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-5 sm:pl-9">{children}</div>
    </fieldset>
  );
}

function Field({
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

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: Option[];
  selected: readonly string[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map(([v, l]) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={v}
              defaultChecked={selected.includes(v)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberRange({
  label,
  minName,
  maxName,
  minDefault,
  maxDefault,
}: {
  label: string;
  minName: string;
  maxName: string;
  minDefault?: number | null;
  maxDefault?: number | null;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`${minName}-input`} className="text-xs text-muted-foreground">
            Min
          </Label>
          <Input
            id={`${minName}-input`}
            name={minName}
            type="number"
            inputMode="numeric"
            placeholder="Min"
            defaultValue={minDefault ?? ""}
          />
        </div>
        <span className="pb-2 text-muted-foreground">–</span>
        <div className="flex-1 space-y-1">
          <Label htmlFor={`${maxName}-input`} className="text-xs text-muted-foreground">
            Max
          </Label>
          <Input
            id={`${maxName}-input`}
            name={maxName}
            type="number"
            inputMode="numeric"
            placeholder="Max"
            defaultValue={maxDefault ?? ""}
          />
        </div>
      </div>
    </div>
  );
}
