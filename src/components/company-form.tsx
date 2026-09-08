"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { CompanyFormFields } from "@/components/company-form-fields";
import { ContactCreatableSelect, type EntityOption } from "@/components/creatable-select";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FormState } from "@/lib/actions/types";
import type { Company } from "@/lib/db/queries/companies";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

export function CompanyForm({
  action,
  company,
  agents,
  additionalAgentIds,
  contacts = [],
  types = [],
  contactRoles = [],
  defaultContactId,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  company?: Company;
  agents: AgentOption[];
  additionalAgentIds?: string[];
  contacts?: EntityOption[];
  types?: { slug: string; label: string }[];
  /** Editable contact-role list — feeds the full "+ New contact" form. */
  contactRoles?: { slug: string; label: string }[];
  /**
   * On edit, the company's existing (primary, else first) contact — pre-selects
   * the required picker so saving an already-compliant company needs no extra
   * clicks. A legacy company with no contacts arrives empty and must be given
   * one before it will save.
   */
  defaultContactId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const duplicateBlocked = state.error?.includes('Tick "Create anyway"') ?? false;

  return (
    <form action={formAction} className="space-y-5">
      {company ? <input type="hidden" name="id" value={company.id} /> : null}

      <CompanyFormFields
        company={company}
        agents={agents}
        additionalAgentIds={additionalAgentIds}
        types={types}
        contactPicker={
          <ContactCreatableSelect
            label="Contact"
            required
            options={contacts}
            defaultValue={defaultContactId ?? ""}
            full={{ agents, roles: contactRoles }}
            hint="Every company needs a point of contact — pick one or add a new one."
          />
        }
      />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {duplicateBlocked ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allow_duplicate"
            className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
          />
          Create anyway (duplicate check override)
        </label>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : company ? "Save changes" : "Create company"}
        </Button>
        <Link
          href={company ? `/companies/${company.id}` : "/companies"}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
