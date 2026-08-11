"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";

import { CompanyCreatableSelect } from "@/components/creatable-select";
import { ContactFormFields } from "@/components/contact-form-fields";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FormState } from "@/lib/actions/types";
import type { Contact } from "@/lib/db/queries/contacts";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

export function ContactForm({
  action,
  contact,
  companies,
  defaultCompanyId,
  agents,
  additionalAgentIds,
  roles,
  companyTypes,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  contact?: Contact;
  companies: { id: string; name: string }[];
  defaultCompanyId?: string;
  agents: AgentOption[];
  additionalAgentIds?: string[];
  roles: { slug: string; label: string }[];
  companyTypes?: { slug: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const c = contact;
  const duplicateBlocked = state.error?.includes('Tick "Create anyway"') ?? false;

  return (
    <form action={formAction} className="space-y-5">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}

      <ContactFormFields
        contact={contact}
        agents={agents}
        additionalAgentIds={additionalAgentIds}
        roles={roles}
        companyPicker={
          <CompanyCreatableSelect
            options={companies}
            defaultValue={c?.company_id ?? defaultCompanyId ?? ""}
            types={companyTypes}
            full={{ agents }}
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
          {pending ? "Saving…" : c ? "Save changes" : "Create contact"}
        </Button>
        <Link
          href={c ? `/contacts/${c.id}` : "/contacts"}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
