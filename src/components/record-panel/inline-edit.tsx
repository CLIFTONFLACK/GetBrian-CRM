"use client";

// Inline editors for the record panels. Each one shows a value with a pencil;
// the pencil swaps in a small form that saves through a narrow server action
// (src/lib/actions/panel-edit.ts) and leaves the panel open. After a save the
// action revalidates the page, so the new value arrives as a new prop.

import * as React from "react";
import { useActionState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";

import { AgentFields } from "@/components/agent-fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listCompanyOptionsForEditor } from "@/lib/actions/panel-edit";
import { listContactOptionsForEditor } from "@/lib/actions/panel-edit-requirement";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
export type InlineKind =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "phone"
  | "select"
  | "tags"
  | "number"
  | "date"
  | "boolean";

const ICON_BUTTON =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        ICON_BUTTON,
        "text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

function SaveCancel({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="submit"
        disabled={pending}
        aria-label="Save"
        className={cn(ICON_BUTTON, "text-success hover:bg-success/10 disabled:opacity-50")}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className={cn(ICON_BUTTON, "text-muted-foreground hover:bg-muted")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * Runs once per new action result, during render (React's documented way to
 * adjust state to a new value without an extra effect).
 */
function useSavedResult(state: FormState, onSaved: () => void, onError?: () => void) {
  const [handled, setHandled] = React.useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.error) onError?.();
    else if (state.message) onSaved();
  }
}

/**
 * Submit handler that calls the action from script instead of through the
 * form action prop. React 19 resets a form after its action runs, even when
 * the action returns an error, which would wipe what the user typed.
 */
function useScriptSubmit(formAction: (fd: FormData) => void) {
  const [, startTransition] = useTransition();
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
}

/** One field of one record. */
export function EditableField({
  action,
  recordId,
  field,
  label,
  kind,
  value,
  display,
  options,
  placeholder,
}: {
  action: Action;
  recordId: string;
  /** The registry key the action looks up. */
  field: string;
  label: string;
  kind: InlineKind;
  /** The stored value as text: tags joined with ", ", booleans as "true" or "false". */
  value: string;
  /** What to show when not editing. Defaults to the text, or a dash. */
  display?: React.ReactNode;
  options?: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [, startTransition] = useTransition();
  const [checked, setChecked] = React.useState(value === "true");

  // A boolean flips straight back to the stored value when a save fails.
  useSavedResult(
    state,
    () => setEditing(false),
    () => setChecked(value === "true"),
  );

  // A boolean also follows the stored value when it changes.
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setChecked(value === "true");
  }

  if (kind === "boolean") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            aria-label={label}
            checked={checked}
            disabled={pending}
            className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
            onChange={(e) => {
              const next = e.target.checked;
              setChecked(next);
              const fd = new FormData();
              fd.set("id", recordId);
              fd.set("field", field);
              fd.set("value", String(next));
              startTransition(() => formAction(fd));
            }}
          />
          <span>{checked ? "Yes" : "No"}</span>
        </label>
        {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      </span>
    );
  }

  if (!editing) {
    return (
      <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
        <span className="min-w-0 break-words whitespace-pre-wrap">
          {display ?? (value ? value : "—")}
        </span>
        <PencilButton
          label={`Edit ${label}`}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        />
      </span>
    );
  }

  const cancel = () => setEditing(false);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") cancel();
  };
  const common = { name: "value", "aria-label": label, autoFocus: true, onKeyDown };

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-1.5"
      onSubmit={(e) => {
        // Nothing changed: close the editor without a write.
        if (draft === value) {
          e.preventDefault();
          setEditing(false);
        }
      }}
    >
      <input type="hidden" name="id" value={recordId} />
      <input type="hidden" name="field" value={field} />
      <div className="flex items-start gap-1.5">
        {kind === "textarea" ? (
          <Textarea
            {...common}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[96px]"
          />
        ) : kind === "select" ? (
          <Select {...common} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8">
            {/* The stored value stays selectable when it is not in the list (a scraped
                status, or none): the box must not silently fall back to the first option. */}
            {!(options ?? []).some((o) => o.value === draft) ? (
              <option value={draft}>{draft || "— Not stated —"}</option>
            ) : null}
            {(options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...common}
            type={kind === "email" ? "email" : kind === "phone" ? "tel" : kind === "date" ? "date" : "text"}
            inputMode={kind === "number" ? "decimal" : undefined}
            value={draft}
            placeholder={kind === "tags" ? "Pub, Bar, Restaurant" : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8"
          />
        )}
        <SaveCancel pending={pending} onCancel={cancel} />
      </div>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

export type AddressValue = {
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
};

/** The four address fields as one group. `startOpen` opens it for a record with no address yet. */
export function EditableAddress({
  action,
  recordId,
  address,
  startOpen = false,
  heading,
}: {
  action: Action;
  recordId: string;
  address: AddressValue;
  startOpen?: boolean;
  /** Shown above the inputs while editing, e.g. "Add an address". */
  heading?: string;
}) {
  const [editing, setEditing] = React.useState(startOpen);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));

  const text =
    [address.address_line, address.city, address.postcode, address.county].filter(Boolean).join(", ") || "—";
  const warning = state.message && state.message !== "Saved." ? state.message : null;

  if (!editing) {
    return (
      <span className="flex flex-col gap-1">
        <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
          <span className="min-w-0 break-words">{text}</span>
          <PencilButton label="Edit address" onClick={() => setEditing(true)} />
        </span>
        {warning ? <span className="text-xs text-amber-700 dark:text-amber-300">{warning}</span> : null}
      </span>
    );
  }

  const id = (n: string) => `addr-${recordId}-${n}`;
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <input type="hidden" name="id" value={recordId} />
      {heading ? <p className="text-sm font-medium">{heading}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("line")} className="text-xs text-muted-foreground">
            Address
          </Label>
          <Input id={id("line")} name="address_line" defaultValue={address.address_line ?? ""} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("city")} className="text-xs text-muted-foreground">
            Town
          </Label>
          <Input id={id("city")} name="city" defaultValue={address.city ?? ""} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("postcode")} className="text-xs text-muted-foreground">
            Postcode
          </Label>
          <Input id={id("postcode")} name="postcode" defaultValue={address.postcode ?? ""} className="h-8" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={id("county")} className="text-xs text-muted-foreground">
            County (filled from the postcode or town when blank)
          </Label>
          <Input id={id("county")} name="county" defaultValue={address.county ?? ""} className="h-8" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SaveCancel pending={pending} onCancel={() => setEditing(false)} />
        {pending ? <span className="text-xs text-muted-foreground">Saving and finding the map pin…</span> : null}
      </div>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

/** Lead agent and additional agents. */
export function EditableAgents({
  action,
  recordId,
  agents,
  leadAgentId,
  additionalAgentIds,
  display,
}: {
  action: Action;
  recordId: string;
  agents: AgentOption[];
  leadAgentId: string | null;
  additionalAgentIds: string[];
  /** The read view: lead and agent badges. */
  display: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));

  if (!editing) {
    return (
      <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
        <span className="flex min-w-0 flex-col gap-2">{display}</span>
        <PencilButton label="Edit agents" onClick={() => setEditing(true)} />
      </span>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <input type="hidden" name="id" value={recordId} />
      <AgentFields
        agents={agents}
        leadAgentId={leadAgentId}
        additionalAgentIds={additionalAgentIds}
        idPrefix={`panel-${recordId}-`}
      />
      <SaveCancel pending={pending} onCancel={() => setEditing(false)} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

/** A contact's company and primary flag. The company list loads only when the editor opens. */
export function EditableContactCompany({
  action,
  contactId,
  companyId,
  isPrimary,
  display,
}: {
  action: Action;
  contactId: string;
  companyId: string | null;
  isPrimary: boolean;
  display: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [options, setOptions] = React.useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(companyId ?? "");
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));

  function open() {
    setSelected(companyId ?? "");
    setEditing(true);
    if (options) return;
    listCompanyOptionsForEditor()
      .then((r) => {
        if ("error" in r) setLoadError(r.error);
        else setOptions(r.options);
      })
      .catch(() => setLoadError("The company list could not be loaded."));
  }

  if (!editing) {
    return (
      <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
        <span className="min-w-0 break-words">{display}</span>
        <PencilButton label="Edit company" onClick={open} />
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <input type="hidden" name="id" value={contactId} />
      {loadError ? (
        <span className="text-xs text-destructive">{loadError}</span>
      ) : options == null ? (
        <span className="text-xs text-muted-foreground">Loading companies…</span>
      ) : (
        <Select
          name="company_id"
          aria-label="Company"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-8"
        >
          <option value="">— No company —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_primary"
          defaultChecked={isPrimary}
          disabled={!selected}
          className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
        />
        Primary contact of this company
      </label>
      {/* Save stays off until the company list has loaded: without the select the form would send no company. */}
      <SaveCancel pending={pending || options == null} onCancel={() => setEditing(false)} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

/** A list of choices as a checkbox group (use classes, tenure). Saves the ticked values. */
export function EditableMulti({
  action,
  recordId,
  field,
  label,
  options,
  values,
  display,
}: {
  action: Action;
  recordId: string;
  /** The registry key the action looks up. */
  field: string;
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  /** The read view, for example a row of badges. */
  display?: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));

  if (!editing) {
    return (
      <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
        <span className="min-w-0 break-words">{display ?? (values.length ? values.join(", ") : "—")}</span>
        <PencilButton label={`Edit ${label}`} onClick={() => setEditing(true)} />
      </span>
    );
  }
  const picked = new Set(values);
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <input type="hidden" name="id" value={recordId} />
      <input type="hidden" name="field" value={field} />
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="value"
              value={o.value}
              defaultChecked={picked.has(o.value)}
              className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <SaveCancel pending={pending} onCancel={() => setEditing(false)} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

/** "Near (place)" and "Within (miles)" on a requirement. A place that is not found is saved, with a warning. */
export function EditableAnchor({
  action,
  recordId,
  text,
  miles,
  display,
}: {
  action: Action;
  recordId: string;
  text: string | null;
  miles: number | null;
  display: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));
  const warning = state.message && state.message !== "Saved." ? state.message : null;

  if (!editing) {
    return (
      <span className="flex flex-col gap-1">
        <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
          <span className="min-w-0 break-words">{display}</span>
          <PencilButton label="Edit radius" onClick={() => setEditing(true)} />
        </span>
        {warning ? <span className="text-xs text-amber-700 dark:text-amber-300">{warning}</span> : null}
      </span>
    );
  }
  const id = (n: string) => `anchor-${recordId}-${n}`;
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <input type="hidden" name="id" value={recordId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
        <div className="space-y-1">
          <Label htmlFor={id("text")} className="text-xs text-muted-foreground">
            Near (place)
          </Label>
          <Input id={id("text")} name="location_anchor_text" defaultValue={text ?? ""} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("miles")} className="text-xs text-muted-foreground">
            Within (miles)
          </Label>
          <Input
            id={id("miles")}
            name="location_radius_miles"
            inputMode="decimal"
            defaultValue={miles != null ? String(miles) : ""}
            className="h-8"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Clear both boxes to remove the radius.</p>
      <SaveCancel pending={pending} onCancel={() => setEditing(false)} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

/**
 * A record's company and contact, as two lists that load when the editor opens.
 * `needContact` only changes the hint: the server enforces the rule.
 */
export function EditableLinks({
  action,
  recordId,
  companyId,
  contactId,
  display,
  hint,
}: {
  action: Action;
  recordId: string;
  companyId: string | null;
  contactId: string | null;
  display: React.ReactNode;
  hint?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [companies, setCompanies] = React.useState<{ id: string; name: string }[] | null>(null);
  const [contacts, setContacts] = React.useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const onSubmit = useScriptSubmit(formAction);
  useSavedResult(state, () => setEditing(false));

  function open() {
    setEditing(true);
    if (companies && contacts) return;
    Promise.all([listCompanyOptionsForEditor(), listContactOptionsForEditor()])
      .then(([c, k]) => {
        if ("error" in c) setLoadError(c.error);
        else if ("error" in k) setLoadError(k.error);
        else {
          setCompanies(c.options);
          setContacts(k.options);
        }
      })
      .catch(() => setLoadError("The lists could not be loaded."));
  }

  if (!editing) {
    return (
      <span className="group inline-flex max-w-full flex-wrap items-start gap-1.5">
        <span className="min-w-0 break-words">{display}</span>
        <PencilButton label="Edit company and contact" onClick={open} />
      </span>
    );
  }
  const id = (n: string) => `links-${recordId}-${n}`;
  const ready = companies != null && contacts != null;
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <input type="hidden" name="id" value={recordId} />
      {loadError ? (
        <span className="text-xs text-destructive">{loadError}</span>
      ) : !ready ? (
        <span className="text-xs text-muted-foreground">Loading…</span>
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor={id("company")} className="text-xs text-muted-foreground">
              Company
            </Label>
            <Select id={id("company")} name="company_id" defaultValue={companyId ?? ""} className="h-8">
              <option value="">— No company —</option>
              {companies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={id("contact")} className="text-xs text-muted-foreground">
              Contact
            </Label>
            <Select id={id("contact")} name="contact_id" defaultValue={contactId ?? ""} className="h-8">
              <option value="">— No contact —</option>
              {contacts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </>
      )}
      {/* Save stays off until both lists have loaded: without the selects the form would send no links. */}
      <SaveCancel pending={pending || !ready} onCancel={() => setEditing(false)} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}
