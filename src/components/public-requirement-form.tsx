"use client";

import * as React from "react";
import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationMultiPicker } from "@/components/location-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitPublicRequirement } from "@/lib/actions/public-intake";
import type { FormState } from "@/lib/actions/types";

const PROPERTY_TYPES = [
  "Restaurant",
  "Bar",
  "Pub",
  "Café / Coffee",
  "Nightclub",
  "Takeaway",
  "Hotel",
  "Health & Fitness",
  "Other leisure",
];

export function PublicRequirementForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    submitPublicRequirement,
    {},
  );
  // Stamped client-side so the elapsed-time spam check has a real render time.
  const [renderedAt] = React.useState(() => Date.now());

  return (
    <form action={formAction} className="space-y-6">
      {/* Honeypot — invisible to people, irresistible to bots. */}
      <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="pr-website">Website</label>
        <input id="pr-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="rendered_at" value={renderedAt} />

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          About you
        </legend>
        <div className="space-y-2">
          <Label htmlFor="pr-company">
            Company / brand<span className="text-destructive"> *</span>
          </Label>
          <Input id="pr-company" name="company_name" required placeholder="e.g. Noble Hops Ltd" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-first">
              First name<span className="text-destructive"> *</span>
            </Label>
            <Input id="pr-first" name="first_name" required autoComplete="given-name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-last">Last name</Label>
            <Input id="pr-last" name="last_name" autoComplete="family-name" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-email">
              Email<span className="text-destructive"> *</span>
            </Label>
            <Input id="pr-email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-phone">Phone</Label>
            <Input id="pr-phone" name="phone" type="tel" autoComplete="tel" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          What you&apos;re looking for
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-type">Property type</Label>
            <Select id="pr-type" name="property_type" defaultValue="">
              <option value="">— Select —</option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          {/* Dataset-validated picks (free text still allowed) — posted as one
              comma-joined `target_locations` value the triage queue parses. */}
          <LocationMultiPicker
            idBase="pr-locations"
            label="Target locations"
            kinds={["zone", "neighbourhood", "town", "county", "region", "district"]}
            name="target_locations"
            placeholder="Search zones, neighbourhoods, towns, counties, postcodes…"
            hint="Pick as many as you like — anything we don't list can be typed in."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-min-sqft">Min size (sq ft)</Label>
            <Input id="pr-min-sqft" name="min_sqft" inputMode="numeric" placeholder="1,000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-max-sqft">Max size (sq ft)</Label>
            <Input id="pr-max-sqft" name="max_sqft" inputMode="numeric" placeholder="3,500" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-min-covers">Min covers</Label>
            <Input id="pr-min-covers" name="min_covers" inputMode="numeric" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-max-covers">Max covers</Label>
            <Input id="pr-max-covers" name="max_covers" inputMode="numeric" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pr-max-rent">Max rent (£ per annum)</Label>
            <Input id="pr-max-rent" name="max_rent" inputMode="numeric" placeholder="120,000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-max-premium">Max premium (£)</Label>
            <Input id="pr-max-premium" name="max_premium" inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pr-notes">Anything else</Label>
          <Textarea
            id="pr-notes"
            name="notes"
            rows={4}
            placeholder="Licensing needs, outside space, fit-out preferences, timing…"
          />
        </div>
      </fieldset>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Submitting…" : "Submit requirement"}
      </Button>
    </form>
  );
}
