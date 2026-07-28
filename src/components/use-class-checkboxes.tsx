"use client";

import * as React from "react";

import { USE_CLASS_OPTIONS } from "@/lib/use-classes";

/**
 * The shared leisure use-class picker: one checkbox per trading concept, posted
 * as repeated values under `name`. Used by requirements (what an operator
 * wants), companies (what they trade as) and listings (what the premises is).
 */
export function UseClassCheckboxes({
  name,
  legend,
  selected,
  hint,
  idPrefix = "",
}: {
  name: string;
  legend: string;
  selected: readonly string[];
  hint?: string;
  /** Keeps input ids unique when this renders in a modal over another form. */
  idPrefix?: string;
}) {
  const chosen = new Set(selected);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {USE_CLASS_OPTIONS.map(([value, label]) => (
          <label
            key={value}
            htmlFor={`${idPrefix}${name}-${value}`}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              id={`${idPrefix}${name}-${value}`}
              type="checkbox"
              name={name}
              value={value}
              defaultChecked={chosen.has(value)}
              className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </fieldset>
  );
}
