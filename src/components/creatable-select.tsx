"use client";

import * as React from "react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { CompanyFormFields } from "@/components/company-form-fields";
import { ContactFormFields } from "@/components/contact-form-fields";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { quickCreateCompany } from "@/lib/actions/companies";
import { quickCreateContact } from "@/lib/actions/contacts";
import type { FormState } from "@/lib/actions/types";
import type { AgentOption } from "@/lib/db/queries/agencies";
import { cn } from "@/lib/utils";

export type EntityOption = { id: string; name: string };

/** Mirrors the location combobox input so the two fields look identical. */
const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** A whole CDG book is thousands of rows — never render more than this at once. */
const MAX_SUGGESTIONS = 50;

/** Rank matches: prefix hits first, then substring hits. `total` drives the "keep typing" hint. */
function filterEntities(
  options: EntityOption[],
  query: string,
): { items: EntityOption[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { items: options.slice(0, MAX_SUGGESTIONS), total: options.length };
  const starts: EntityOption[] = [];
  const contains: EntityOption[] = [];
  for (const o of options) {
    const n = o.name.toLowerCase();
    if (n.startsWith(q)) starts.push(o);
    else if (n.includes(q)) contains.push(o);
  }
  return {
    items: [...starts, ...contains].slice(0, MAX_SUGGESTIONS),
    total: starts.length + contains.length,
  };
}

/** Suggestion listbox — selection via onPick (mousedown, so blur can still close). */
function EntitySuggestionList({
  items,
  total,
  highlighted,
  selectedId,
  onPick,
  listId,
  emptyLabel,
}: {
  items: EntityOption[];
  total: number;
  highlighted: number;
  selectedId: string;
  onPick: (option: EntityOption) => void;
  listId: string;
  emptyLabel: string;
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
    >
      {items.length === 0 ? (
        <li className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</li>
      ) : null}
      {items.map((o, i) => (
        <li
          key={o.id}
          role="option"
          aria-selected={i === highlighted}
          id={`${listId}-${i}`}
          className={cn(
            "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5",
            i === highlighted ? "bg-muted" : "hover:bg-muted",
          )}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(o);
          }}
        >
          <span className="truncate">{o.name}</span>
          {o.id === selectedId ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          ) : null}
        </li>
      ))}
      {total > items.length ? (
        <li className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
          Showing {items.length} of {total} — keep typing to narrow.
        </li>
      ) : null}
    </ul>
  );
}

/**
 * A searchable single-select bound to a parent form, plus a "+ New …" button that
 * opens a modal to quick-create a related record. On success the new record is
 * added to the options and selected. The modal is portalled to <body>, so its
 * <form> never nests inside the parent form.
 *
 * The field posts exactly as the old <select> did — a hidden input carrying the
 * record id under `name`. The visible input is a type-ahead combobox whose text
 * is always either empty or the exact name of the selected record (a stray query
 * is reverted on blur), so `required` on it is a faithful proxy for "an id is set".
 */
export function CreatableSelect({
  name,
  label,
  placeholder = "— None —",
  options: initial,
  defaultValue = "",
  required,
  hint,
  action,
  modalTitle,
  createLabel,
  modalSize = "sm",
  allowCreate = true,
  idPrefix = "",
  children,
}: {
  name: string;
  label: string;
  placeholder?: string;
  options: EntityOption[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  modalTitle: string;
  createLabel: string;
  /** "lg" for the full record forms, "sm" for the short quick-create. */
  modalSize?: "sm" | "lg";
  /**
   * Hide the "+ New" button. Set when this picker is itself rendered inside a
   * quick-create modal, so a modal can never open another modal.
   */
  allowCreate?: boolean;
  /** Keeps the input id unique when this picker renders in a modal over a form. */
  idPrefix?: string;
  children: React.ReactNode;
}) {
  const [options, setOptions] = useState<EntityOption[]>(initial);
  const [value, setValue] = useState(defaultValue);
  /** `null` while untouched — the input then mirrors the selected record's name. */
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const lastCreated = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = state.created;
    if (c && c.id !== lastCreated.current) {
      lastCreated.current = c.id;
      setOptions((prev) =>
        prev.some((o) => o.id === c.id)
          ? prev
          : [...prev, { id: c.id, name: c.name }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
      setValue(c.id);
      setQuery(null);
      setModalOpen(false);
    }
  }, [state.created]);

  const selected = options.find((o) => o.id === value) ?? null;
  const text = query ?? selected?.name ?? "";
  const results = useMemo(() => filterEntities(options, query ?? ""), [options, query]);
  const items = open ? results.items : [];
  // The list shrinks as the query narrows — clamp at use-time, not in an effect.
  const active = Math.min(highlighted, Math.max(0, items.length - 1));
  const inputId = `${idPrefix}${name}`;
  const listId = `${inputId}-listbox`;

  const pick = (o: EntityOption) => {
    setValue(o.id);
    setQuery(null);
    setOpen(false);
    setHighlighted(0);
  };

  const clear = () => {
    setValue("");
    setQuery(null);
    setHighlighted(0);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            id={inputId}
            value={text}
            required={required}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              open && items.length ? `${listId}-${active}` : undefined
            }
            className={cn(INPUT_CLASS, value ? "pr-8" : undefined)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlighted(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              // A query that never landed on a record is discarded; clearing the
              // text clears the selection.
              if (query !== null) {
                if (query.trim() === "") setValue("");
                setQuery(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!open) setOpen(true);
                else setHighlighted(Math.min(active + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) setOpen(true);
                else setHighlighted(Math.max(active - 1, 0));
              } else if (e.key === "Enter") {
                if (open && items.length) {
                  e.preventDefault();
                  pick(items[active]);
                } else if (query !== null) {
                  // Unresolved text — don't let it submit the parent form.
                  e.preventDefault();
                }
              } else if (e.key === "Escape") {
                if (!open && query === null) return;
                // Don't let an enclosing Modal's document listener close it too.
                e.stopPropagation();
                setOpen(false);
                setQuery(null);
              }
            }}
          />
          {value ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()}`}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
              onClick={clear}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {open ? (
            <EntitySuggestionList
              items={items}
              total={results.total}
              highlighted={active}
              selectedId={value}
              listId={listId}
              onPick={pick}
              emptyLabel={
                options.length === 0
                  ? allowCreate
                    ? "Nothing to pick yet — use “+ New”."
                    : "Nothing to pick yet."
                  : allowCreate
                    ? "No matches — use “+ New” to add one."
                    : "No matches."
              }
            />
          ) : null}
        </div>
        <input type="hidden" name={name} value={value} />
        {allowCreate ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setModalOpen(true)}
          >
            <Plus />
            New
          </Button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        size={modalSize}
      >
        <form action={formAction} className="space-y-4">
          {children}
          {state.error ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : createLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/**
 * Fallback for callers that don't pass the editable `company_types` list —
 * mirrors the seeded system types so the modal keeps working everywhere.
 */
const DEFAULT_COMPANY_TYPES: { slug: string; label: string }[] = [
  { slug: "operator", label: "Operator" },
  { slug: "landlord", label: "Landlord" },
  { slug: "agent", label: "Agent" },
  { slug: "vendor", label: "Vendor" },
  { slug: "other", label: "Other" },
];

/**
 * Company picker with an inline "+ New company" modal. Pass `full` (the agency
 * roster) and the modal carries the entire company form — address, CRN, agents
 * and all — instead of just a name and a type. Callers without the roster to
 * hand keep the short version.
 */
export function CompanyCreatableSelect({
  name = "company_id",
  label = "Company",
  options,
  defaultValue,
  required,
  hint,
  placeholder,
  types,
  full,
  allowCreate,
  idPrefix,
}: {
  name?: string;
  label?: string;
  options: EntityOption[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Editable company-type list; falls back to the seeded system types. */
  types?: { slug: string; label: string }[];
  /** Supply to swap the short quick-create for the whole company form. */
  full?: { agents: AgentOption[] };
  allowCreate?: boolean;
  idPrefix?: string;
}) {
  const typeOptions = types && types.length > 0 ? types : DEFAULT_COMPANY_TYPES;
  return (
    <CreatableSelect
      name={name}
      label={label}
      options={options}
      defaultValue={defaultValue}
      required={required}
      hint={hint}
      placeholder={placeholder}
      action={quickCreateCompany}
      modalTitle="New company"
      createLabel="Create company"
      modalSize={full ? "lg" : "sm"}
      allowCreate={allowCreate}
      idPrefix={idPrefix}
    >
      {full ? (
        <CompanyFormFields
          types={typeOptions}
          agents={full.agents}
          idPrefix="qc-company-"
        />
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="qc-company-name">
              Company name<span className="text-destructive"> *</span>
            </Label>
            <Input id="qc-company-name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-company-type">Type</Label>
            <Select
              id="qc-company-type"
              name="type"
              defaultValue={typeOptions[0]?.slug ?? "other"}
            >
              {typeOptions.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}
    </CreatableSelect>
  );
}

/**
 * Contact picker with an inline "+ New contact" modal. Pass `full` (roster plus
 * the editable role list) and the modal carries the entire contact form rather
 * than just a name and an email.
 */
export function ContactCreatableSelect({
  name = "link_contact",
  label = "Contact",
  options,
  defaultValue,
  required,
  hint,
  placeholder,
  full,
  allowCreate,
  idPrefix,
}: {
  name?: string;
  label?: string;
  options: EntityOption[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Supply to swap the short quick-create for the whole contact form. */
  full?: { agents: AgentOption[]; roles: { slug: string; label: string }[] };
  allowCreate?: boolean;
  idPrefix?: string;
}) {
  return (
    <CreatableSelect
      name={name}
      label={label}
      options={options}
      defaultValue={defaultValue}
      required={required}
      hint={hint}
      placeholder={placeholder}
      action={quickCreateContact}
      modalTitle="New contact"
      createLabel="Create contact"
      modalSize={full ? "lg" : "sm"}
      allowCreate={allowCreate}
      idPrefix={idPrefix}
    >
      {full ? (
        <ContactFormFields
          roles={full.roles}
          agents={full.agents}
          idPrefix="qc-contact-"
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="qc-contact-first">
                First name<span className="text-destructive"> *</span>
              </Label>
              <Input id="qc-contact-first" name="first_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-contact-last">Last name</Label>
              <Input id="qc-contact-last" name="last_name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="qc-contact-email">Email</Label>
            <Input id="qc-contact-email" name="email" type="email" />
          </div>
        </>
      )}
    </CreatableSelect>
  );
}
