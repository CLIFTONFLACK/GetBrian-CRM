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
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Input } from "@/components/ui/input";
import { LocationSelect } from "@/components/location-select";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UseClassCheckboxes } from "@/components/use-class-checkboxes";
import type { FormState } from "@/lib/actions/types";
import type { Tables } from "@/lib/database.types";
import type { AgentOption } from "@/lib/supabase/agency";
import { parseUseClasses } from "@/lib/use-classes";
import { cn } from "@/lib/utils";

type Option = readonly [string, string];

const STATUSES: Option[] = [
  ["Available", "Available"],
  ["Under Offer", "Under Offer"],
  ["Let", "Let"],
  ["Sold", "Sold"],
  ["Withdrawn", "Withdrawn"],
];
const DISPOSAL_TYPES: Option[] = [
  ["unknown", "Unspecified"],
  ["freehold", "Freehold"],
  ["new_lease", "New lease"],
  ["lease_assignment", "Lease assignment"],
  ["sublease", "Sublease"],
];
const FIT_OUTS: Option[] = [
  ["", "—"],
  ["fully_fitted", "Fully fitted"],
  ["part_fitted", "Part fitted"],
  ["shell", "Shell"],
];
const LISTING_TYPES: Option[] = [
  ["cdg", "CDG — our instruction"],
  ["intel", "INTEL — market intelligence"],
];
const PRICE_QUALIFIERS: Option[] = [
  ["", "—"],
  ["fixed", "Fixed"],
  ["offers_in_region", "Offers in the region of"],
  ["offers_in_excess", "Offers in excess of"],
  ["on_application", "On application"],
];

type PickOption = { id: string; name: string };

export function DisposalForm({
  action,
  disposal,
  agents,
  additionalAgentIds,
  companies = [],
  contacts = [],
  companyTypes,
  contactRoles = [],
  defaultCompanyId,
  defaultContactId,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  disposal?: Tables<"disposals">;
  agents: AgentOption[];
  additionalAgentIds?: string[];
  companies?: PickOption[];
  contacts?: PickOption[];
  /** Editable company_types list — feeds the "+ New company" quick-create modal. */
  companyTypes?: { slug: string; label: string }[];
  /** Editable contact_roles list — feeds the "+ New contact" quick-create modal. */
  contactRoles?: { slug: string; label: string }[];
  defaultCompanyId?: string;
  defaultContactId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const d = disposal;

  return (
    <form action={formAction} className="space-y-8">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}

      <Section title="Listing">
        <Field label="Title" htmlFor="title" required>
          <Input
            id="title"
            name="title"
            defaultValue={d?.title ?? ""}
            placeholder="e.g. Corner bar, Soho"
            required
          />
        </Field>
        <Field
          label="Type"
          htmlFor="listing_type"
          hint="INTEL listings produce an unbranded PDF (no CDG branding)."
        >
          <Select
            id="listing_type"
            name="listing_type"
            defaultValue={d?.listing_type ?? "cdg"}
          >
            {LISTING_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={d?.status ?? "Available"}>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Disposal type" htmlFor="disposal_type">
            <Select
              id="disposal_type"
              name="disposal_type"
              defaultValue={d?.disposal_type ?? "unknown"}
            >
              {DISPOSAL_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="to_let" label="To let" defaultChecked={d?.to_let ?? false} />
          <Checkbox name="for_sale" label="For sale" defaultChecked={d?.for_sale ?? false} />
        </div>
      </Section>

      <Section title="Location">
        <Field label="Address" htmlFor="address_line">
          <Input id="address_line" name="address_line" defaultValue={d?.address_line ?? ""} />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Area" htmlFor="area">
            <Input id="area" name="area" defaultValue={d?.area ?? ""} />
          </Field>
          <LocationSelect
            name="city"
            label="Town / city"
            kinds={["town"]}
            defaultValue={d?.city ?? ""}
          />
          <LocationSelect
            name="county"
            label="County"
            kinds={["county"]}
            defaultValue={d?.county ?? ""}
            hint="Auto-filled from postcode/town if left blank"
          />
          <LocationSelect
            name="postcode"
            label="Postcode"
            kinds={["district"]}
            defaultValue={d?.postcode ?? ""}
            placeholder="e.g. W1D 3QF"
          />
        </div>
      </Section>

      <Section title="Premises">
        <UseClassCheckboxes
          name="use_classes"
          legend="Use class"
          selected={parseUseClasses(d?.property_type, d?.use_class)}
          hint="What the premises trades as. The planning class (Class E / Sui Generis) is derived from this — and it's what requirements are matched against."
        />
        {/* A scraped row can carry a planning class with no concept to tick —
            keep it rather than clearing it on an unrelated edit. */}
        {d?.use_class ? (
          <input type="hidden" name="use_class_carried" value={d.use_class} />
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Size (sq ft)" htmlFor="size_sqft">
            <Input id="size_sqft" name="size_sqft" type="number" inputMode="numeric" defaultValue={d?.size_sqft ?? ""} />
          </Field>
          <Field label="Size (sq m)" htmlFor="size_sqm">
            <Input id="size_sqm" name="size_sqm" type="number" inputMode="numeric" defaultValue={d?.size_sqm ?? ""} />
          </Field>
          <Field label="Covers — internal" htmlFor="covers_internal">
            <Input id="covers_internal" name="covers_internal" type="number" inputMode="numeric" defaultValue={d?.covers_internal ?? ""} />
          </Field>
          <Field label="Covers — external" htmlFor="covers_external">
            <Input id="covers_external" name="covers_external" type="number" inputMode="numeric" defaultValue={d?.covers_external ?? ""} />
          </Field>
          <Field label="Fit-out" htmlFor="fit_out_state">
            <Select id="fit_out_state" name="fit_out_state" defaultValue={d?.fit_out_state ?? ""}>
              {FIT_OUTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="EPC rating" htmlFor="epc_rating">
            <Input id="epc_rating" name="epc_rating" defaultValue={d?.epc_rating ?? ""} />
          </Field>
        </div>
      </Section>

      <Section title="Commercials">
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Rent (£ pa)" htmlFor="rent_pa">
            <Input id="rent_pa" name="rent_pa" type="number" inputMode="numeric" defaultValue={d?.rent_pa ?? ""} />
          </Field>
          <Field label="Premium (£)" htmlFor="premium">
            <Input id="premium" name="premium" type="number" inputMode="numeric" defaultValue={d?.premium ?? ""} />
          </Field>
          <Field label="Guide price (£)" htmlFor="guide_price">
            <Input id="guide_price" name="guide_price" type="number" inputMode="numeric" defaultValue={d?.guide_price ?? ""} />
          </Field>
          <Field label="Rateable value (£)" htmlFor="rateable_value">
            <Input id="rateable_value" name="rateable_value" type="number" inputMode="numeric" defaultValue={d?.rateable_value ?? ""} />
          </Field>
          <Field label="Service charge (£)" htmlFor="service_charge">
            <Input id="service_charge" name="service_charge" type="number" inputMode="numeric" defaultValue={d?.service_charge ?? ""} />
          </Field>
          <Field label="Tenure" htmlFor="tenure_raw">
            <Input id="tenure_raw" name="tenure_raw" placeholder="e.g. New 15-year lease" defaultValue={d?.tenure_raw ?? ""} />
          </Field>
        </div>
      </Section>

      <LeaseStatutorySection d={d} />

      <Section title="Detail">
        <Field label="Key features" htmlFor="key_features" hint="Comma-separated">
          <Input
            id="key_features"
            name="key_features"
            defaultValue={(d?.key_features ?? []).join(", ")}
          />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" name="description" defaultValue={d?.description ?? ""} />
        </Field>
      </Section>

      <Section title="Links">
        <div className="grid gap-5 sm:grid-cols-2">
          <CompanyCreatableSelect
            options={companies}
            defaultValue={d?.company_id ?? defaultCompanyId ?? ""}
            types={companyTypes}
            full={{ agents }}
            hint="Landlord / vendor / marketing company — optional"
          />
          <ContactCreatableSelect
            name="contact_id"
            label="Contact"
            required
            placeholder="Select a contact…"
            options={contacts}
            defaultValue={d?.contact_id ?? defaultContactId ?? ""}
            full={{ agents, roles: contactRoles }}
            hint="Point of contact for this listing — required"
          />
        </div>
      </Section>

      <Section title="Assignment">
        <AgentFields
          agents={agents}
          leadAgentId={d?.lead_agent_id}
          additionalAgentIds={additionalAgentIds}
        />
      </Section>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : d ? "Save changes" : "Create listing"}
        </Button>
        <Link
          href={d ? `/listings/${d.id}` : "/listings"}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * "Lease & statutory" — collapsible section exposing the DB columns that were
 * previously only reachable via scrapes (lease terms, 1954 Act, VAT, rates,
 * licensing, marketing extras). Opens automatically when any field has data.
 */
function LeaseStatutorySection({ d }: { d?: Tables<"disposals"> }) {
  const hasData = Boolean(
    d &&
      (d.summary ||
        d.location_description ||
        d.licensing_notes ||
        d.vat_applicable ||
        d.business_rates != null ||
        d.estate_charge != null ||
        d.parking_charge != null ||
        d.lease_term_years != null ||
        d.lease_expiry ||
        d.rent_review_basis ||
        d.next_rent_review != null ||
        d.inside_1954_act ||
        d.rent_period ||
        d.price_qualifier ||
        d.brochure_url),
  );
  return (
    <CollapsibleCard
      title="Lease & statutory"
      description="Lease terms, statutory notes, charges and marketing extras — all optional."
      defaultOpen={hasData}
    >
      <div className="space-y-5">
        <Field
          label="Summary"
          htmlFor="summary"
          hint="One-line marketing strapline — the teal headline on the PDF."
        >
          <Input id="summary" name="summary" defaultValue={d?.summary ?? ""} />
        </Field>
        <Field label="Location description" htmlFor="location_description">
          <Textarea
            id="location_description"
            name="location_description"
            defaultValue={d?.location_description ?? ""}
          />
        </Field>
        <Field label="Licensing notes" htmlFor="licensing_notes">
          <Textarea
            id="licensing_notes"
            name="licensing_notes"
            defaultValue={d?.licensing_notes ?? ""}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Lease term (years)" htmlFor="lease_term_years">
            <Input
              id="lease_term_years"
              name="lease_term_years"
              type="number"
              inputMode="numeric"
              defaultValue={d?.lease_term_years ?? ""}
            />
          </Field>
          <Field label="Lease expiry" htmlFor="lease_expiry">
            <Input
              id="lease_expiry"
              name="lease_expiry"
              type="date"
              defaultValue={d?.lease_expiry ?? ""}
            />
          </Field>
          <Field label="Rent review basis" htmlFor="rent_review_basis">
            <Input
              id="rent_review_basis"
              name="rent_review_basis"
              placeholder="e.g. Open market, 5-yearly"
              defaultValue={d?.rent_review_basis ?? ""}
            />
          </Field>
          <Field label="Next rent review (year)" htmlFor="next_rent_review">
            <Input
              id="next_rent_review"
              name="next_rent_review"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 2029"
              defaultValue={d?.next_rent_review ?? ""}
            />
          </Field>
          <Field label="Rent period" htmlFor="rent_period">
            <Input
              id="rent_period"
              name="rent_period"
              placeholder="e.g. per annum exclusive"
              defaultValue={d?.rent_period ?? ""}
            />
          </Field>
          <Field label="Price qualifier" htmlFor="price_qualifier">
            <Select
              id="price_qualifier"
              name="price_qualifier"
              defaultValue={d?.price_qualifier ?? ""}
            >
              {PRICE_QUALIFIERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Business rates (£ pa)" htmlFor="business_rates">
            <Input
              id="business_rates"
              name="business_rates"
              type="number"
              inputMode="numeric"
              defaultValue={d?.business_rates ?? ""}
            />
          </Field>
          <Field label="Estate charge (£ pa)" htmlFor="estate_charge">
            <Input
              id="estate_charge"
              name="estate_charge"
              type="number"
              inputMode="numeric"
              defaultValue={d?.estate_charge ?? ""}
            />
          </Field>
          <Field label="Parking charge (£ pa)" htmlFor="parking_charge">
            <Input
              id="parking_charge"
              name="parking_charge"
              type="number"
              inputMode="numeric"
              defaultValue={d?.parking_charge ?? ""}
            />
          </Field>
          <Field label="Brochure URL" htmlFor="brochure_url">
            <Input
              id="brochure_url"
              name="brochure_url"
              type="url"
              placeholder="https://…"
              defaultValue={d?.brochure_url ?? ""}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox
            name="vat_applicable"
            label="VAT applicable"
            defaultChecked={d?.vat_applicable ?? false}
          />
          <Checkbox
            name="inside_1954_act"
            label="Inside the 1954 Act (security of tenure)"
            defaultChecked={d?.inside_1954_act ?? false}
          />
        </div>
      </div>
    </CollapsibleCard>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-foreground">{title}</legend>
      {children}
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

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      {label}
    </label>
  );
}
