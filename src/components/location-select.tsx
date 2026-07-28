"use client";

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  KIND_LABELS,
  optionsForKinds,
  type LocationKind,
  type LocationOption,
} from "@/lib/locations/options";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const MAX_SUGGESTIONS = 30;
/**
 * Per-kind cap. Towns outnumber London neighbourhoods ~7:1 and postcode
 * districts outnumber both, so a single global cap let one kind fill the whole
 * list and bury the rest — "Zone 2" or "Shoreditch" would never surface behind
 * a wall of towns.
 */
const MAX_PER_KIND = 5;
/** There are only nine fare zones — never show a partial list of them. */
const PER_KIND_CAP: Partial<Record<LocationKind, number>> = { zone: 9 };
const capFor = (kind: LocationKind) => PER_KIND_CAP[kind] ?? MAX_PER_KIND;

/**
 * Rank matches: prefix hits before substring hits *within* each kind, then emit
 * the kinds in the order the caller asked for them (which is also the order the
 * grouped listbox renders its headers in).
 */
function filterOptions(
  options: LocationOption[],
  query: string,
  exclude: ReadonlySet<string>,
): LocationOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byKind = new Map<
    LocationKind,
    { starts: LocationOption[]; contains: LocationOption[] }
  >();
  for (const o of options) {
    if (exclude.has(o.value.toLowerCase())) continue;
    const v = o.value.toLowerCase();
    const isStart = v.startsWith(q);
    const extra = (o.search ?? o.detail)?.toLowerCase();
    if (!isStart && !v.includes(q) && !extra?.includes(q)) continue;
    const cap = capFor(o.kind);
    const bucket = byKind.get(o.kind) ?? { starts: [], contains: [] };
    // Each list is capped independently so a run of substring hits early in the
    // alphabet can't crowd out a prefix hit that appears later ("Balham" must
    // not squeeze out "Hammersmith" for the query "ham").
    const list = isStart ? bucket.starts : bucket.contains;
    if (list.length < cap) list.push(o);
    byKind.set(o.kind, bucket);
  }
  const out: LocationOption[] = [];
  for (const [kind, { starts, contains }] of byKind)
    out.push(...[...starts, ...contains].slice(0, capFor(kind)));
  return out.slice(0, MAX_SUGGESTIONS);
}

/** Grouped suggestion listbox; selection via onPick (mousedown, so blur can close). */
function SuggestionList({
  items,
  highlighted,
  onPick,
  listId,
}: {
  items: LocationOption[];
  highlighted: number;
  onPick: (option: LocationOption) => void;
  listId: string;
}) {
  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
    >
      {items.map((o, i) => {
        const header =
          i === 0 || items[i - 1].kind !== o.kind ? KIND_LABELS[o.kind] : null;
        return (
          <React.Fragment key={`${o.kind}:${o.value}`}>
            {header ? (
              <li className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {header}
              </li>
            ) : null}
            <li
              role="option"
              aria-selected={i === highlighted}
              id={`${listId}-${i}`}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                i === highlighted ? "bg-muted" : "hover:bg-muted",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(o);
              }}
            >
              <span>{o.value}</span>
              {o.detail ? (
                <span className="text-xs text-muted-foreground">{o.detail}</span>
              ) : null}
            </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
}

/**
 * Single-value location field: a real text input (name submits as before —
 * free text always allowed) with a searchable suggestion dropdown over the UK
 * locations dataset.
 */
export function LocationSelect({
  name,
  label,
  kinds,
  defaultValue = "",
  required,
  hint,
  placeholder,
  idPrefix = "",
}: {
  name: string;
  label: string;
  kinds: LocationKind[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Keeps the input id unique when this field renders in a modal over another form. */
  idPrefix?: string;
}) {
  const options = useMemo(() => optionsForKinds(kinds), [kinds]);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputId = `${idPrefix}${name}`;
  const listId = `${inputId}-listbox`;
  const none = useMemo(() => new Set<string>(), []);
  const items = open ? filterOptions(options, value, none) : [];

  return (
    <div className="relative space-y-2">
      <Label htmlFor={inputId}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <input
        id={inputId}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={items.length ? `${listId}-${highlighted}` : undefined}
        className={INPUT_CLASS}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!items.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            setValue(items[highlighted].value);
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {items.length > 0 ? (
        <SuggestionList
          items={items}
          highlighted={highlighted}
          listId={listId}
          onPick={(o) => {
            setValue(o.value);
            setOpen(false);
          }}
        />
      ) : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export type PickedLocation = { kind: LocationKind; value: string };

/**
 * Multi-value location picker: search box + removable chips. Selected values
 * are exposed to the parent form through hidden inputs — either one input
 * (`name`, comma-joined) or one per kind (`namesByKind`), matching the
 * server's existing comma-array parsing.
 */
export function LocationMultiPicker({
  idBase,
  label,
  kinds,
  name,
  namesByKind,
  defaultSelected = [],
  freeTextKind = "town",
  required,
  hint,
  placeholder = "Search towns, counties, regions, postcode districts…",
}: {
  idBase: string;
  label: string;
  kinds: LocationKind[];
  name?: string;
  namesByKind?: Partial<Record<LocationKind, string>>;
  defaultSelected?: PickedLocation[];
  /** Kind recorded for free-typed values the dataset doesn't recognise. */
  freeTextKind?: LocationKind;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  const options = useMemo(() => optionsForKinds(kinds), [kinds]);
  const [selected, setSelected] = useState<PickedLocation[]>(defaultSelected);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `${idBase}-listbox`;

  const exclude = useMemo(
    () => new Set(selected.map((s) => s.value.toLowerCase())),
    [selected],
  );
  const items = open ? filterOptions(options, query, exclude) : [];
  // A bare outward group like "W1" isn't a real district (only W1A…W1W are),
  // but it's exactly what users mean by "postcode W1" — offer it first.
  const districtish = query.trim().toUpperCase();
  if (
    open &&
    kinds.includes("district") &&
    /^[A-Z]{1,2}\d[A-Z\d]?$/.test(districtish) &&
    !exclude.has(districtish.toLowerCase()) &&
    !items.some((o) => o.kind === "district" && o.value === districtish)
  ) {
    items.unshift({ kind: "district", value: districtish, detail: "whole district" });
  }

  const add = (pick: PickedLocation) => {
    setSelected((prev) =>
      prev.some((p) => p.value.toLowerCase() === pick.value.toLowerCase())
        ? prev
        : [...prev, pick],
    );
    setQuery("");
    setHighlighted(0);
  };
  const remove = (value: string) =>
    setSelected((prev) => prev.filter((p) => p.value !== value));

  const addFreeText = () => {
    const v = query.trim();
    if (!v) return;
    const known = options.find((o) => o.value.toLowerCase() === v.toLowerCase());
    if (known) add({ kind: known.kind, value: known.value });
    else
      add({
        kind: freeTextKind,
        value: /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/.test(v) ? v.toUpperCase() : v,
      });
  };

  // The suggestion list shrinks as the query narrows — clamp at use-time
  // rather than in an effect.
  const active = Math.min(highlighted, Math.max(0, items.length - 1));

  const kindsWithNames: [LocationKind, string][] = namesByKind
    ? (Object.entries(namesByKind) as [LocationKind, string][])
    : [];

  return (
    <div className="space-y-2">
      <Label htmlFor={`${idBase}-input`}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <div className="relative">
        <div
          className={cn(
            INPUT_CLASS,
            "flex h-auto min-h-9 flex-wrap items-center gap-1.5 py-1.5",
          )}
        >
          {selected.map((s) => (
            <span
              key={s.value}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              <MapPin className="h-3 w-3 text-muted-foreground" aria-hidden />
              {s.value}
              <button
                type="button"
                aria-label={`Remove ${s.value}`}
                className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                onClick={() => {
                  remove(s.value);
                  inputRef.current?.focus();
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${idBase}-input`}
            value={query}
            placeholder={selected.length === 0 ? placeholder : "Add another…"}
            autoComplete="off"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
            className="min-w-32 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlighted(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && items.length) {
                e.preventDefault();
                setHighlighted(Math.min(active + 1, items.length - 1));
              } else if (e.key === "ArrowUp" && items.length) {
                e.preventDefault();
                setHighlighted(Math.max(active - 1, 0));
              } else if (e.key === "Enter") {
                if (!query.trim() && !items.length) return;
                e.preventDefault();
                if (items.length) add({ kind: items[active].kind, value: items[active].value });
                else addFreeText();
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "Backspace" && !query && selected.length) {
                remove(selected[selected.length - 1].value);
              }
            }}
          />
        </div>
        {items.length > 0 ? (
          <SuggestionList
            items={items}
            highlighted={active}
            listId={listId}
            onPick={(o) => {
              add({ kind: o.kind, value: o.value });
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </div>
      {name ? (
        <input type="hidden" name={name} value={selected.map((s) => s.value).join(", ")} />
      ) : null}
      {kindsWithNames.map(([kind, inputName]) => (
        <input
          key={kind}
          type="hidden"
          name={inputName}
          value={selected
            .filter((s) => s.kind === kind)
            .map((s) => s.value)
            .join(", ")}
        />
      ))}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
