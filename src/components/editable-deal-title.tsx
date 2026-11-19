"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Check, Pencil, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { updateDealTitle } from "@/lib/actions/deals";
import type { FormState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Save"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-success hover:bg-success/10 disabled:opacity-50"
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Deal title with an inline pencil-icon editor — used wherever a deal's name
 * is displayed (board cards, detail header, linked-deal sections). Renders as
 * a Link when `href` is given, plain text otherwise; the pencil swaps in a
 * small form that saves via the narrow `updateDealTitle` action and updates
 * on screen immediately, no page reload.
 */
export function EditableDealTitle({
  dealId,
  title,
  href,
  className,
}: {
  dealId: string;
  title: string;
  href?: string;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(title);
  const [draft, setDraft] = React.useState(title);
  const [state, action] = useActionState<FormState, FormData>(updateDealTitle, {});

  // Follow the prop. A rename saved somewhere else (the deal panel, the full
  // page) reaches this component as a new `title`. Without this the card keeps
  // the title it was first rendered with. An open edit keeps the user's draft.
  const [seenTitle, setSeenTitle] = React.useState(title);
  if (seenTitle !== title) {
    setSeenTitle(title);
    setValue(title);
    if (!editing) setDraft(title);
  }

  // Adjust state in response to a new action result during render (React's
  // documented pattern for this — avoids an extra effect-triggered render).
  const [handledState, setHandledState] = React.useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.message) {
      setValue(draft);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <form
        action={action}
        className="inline-flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          if (!draft.trim()) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={dealId} />
        <Input
          name="title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          autoFocus
          className={cn("h-7 w-auto px-2 text-sm", className)}
        />
        <SaveButton />
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
          aria-label="Cancel"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {state.error ? (
          <span className="w-full text-xs text-destructive">{state.error}</span>
        ) : null}
      </form>
    );
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      {href ? (
        <Link href={href} className={className}>
          {value}
        </Link>
      ) : (
        <span className={className}>{value}</span>
      )}
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        aria-label={`Rename ${value}`}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
