"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { setRequirementRating } from "@/lib/actions/requirements";
import { ratingLabel } from "@/lib/listing-rating";
import { cn } from "@/lib/utils";

// Colour contrast on a light ground (the stars carry meaning only together with
// the text label, but the outlines still need 3:1 as graphics):
//   filled: amber-400 fill, amber-600 outline (#d97706, about 3.2:1 on white)
//   empty:  zinc-500 outline (#71717a, about 4.8:1 on white), no fill
const FILLED = "fill-amber-400 text-amber-600 dark:text-amber-400";
const EMPTY = "fill-transparent text-zinc-500 dark:text-zinc-400";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Listing Rating as five stars plus its text label.
 *
 * Read-only mode (a list cell, or a viewer who may not edit) renders one image
 * with no buttons. Editable mode is a radiogroup: arrow keys move focus, Enter
 * or Space picks the star, picking the current star clears the rating. The
 * write goes through setRequirementRating, which enforces who may edit; the
 * `readOnly` flag here only hides the controls.
 */
export function StarRating({
  value,
  requirementId,
  readOnly = false,
  compact = false,
  className,
}: {
  value: number | null;
  /** Needed for editable mode. */
  requirementId?: string;
  readOnly?: boolean;
  /** Smaller stars, for table cells. */
  compact?: boolean;
  className?: string;
}) {
  const label = ratingLabel(value);
  const iconSize = compact ? "h-4 w-4" : "h-6 w-6";

  if (readOnly || !requirementId) {
    return (
      <span
        className={cn(
          compact ? "inline-flex flex-col items-start gap-0.5" : "inline-flex items-center gap-2",
          className,
        )}
      >
        <span
          role="img"
          aria-label={
            value ? `${value} of 5 stars: ${label}` : "Not rated"
          }
          className="inline-flex items-center"
        >
          {STARS.map((n) => (
            <Star
              key={n}
              aria-hidden="true"
              className={cn(iconSize, "shrink-0", value != null && n <= value ? FILLED : EMPTY)}
            />
          ))}
        </span>
        <span className={compact ? "text-xs text-muted-foreground" : "text-sm text-foreground"}>
          {label}
        </span>
      </span>
    );
  }

  return <EditableStars value={value} requirementId={requirementId} className={className} />;
}

function EditableStars({
  value,
  requirementId,
  className,
}: {
  value: number | null;
  requirementId: string;
  className?: string;
}) {
  // `confirmed` keeps a saved value until the parent's prop catches up. Without
  // it the stars would snap back to the old prop between the end of the
  // optimistic transition and the page re-render that carries the new value.
  // It is dropped as soon as the prop changes, so a later outside change wins.
  const [confirmed, setConfirmed] = React.useState<{ from: number | null; to: number | null } | null>(null);
  const [seenValue, setSeenValue] = React.useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setConfirmed(null);
  }
  const effective = confirmed && confirmed.from === value ? confirmed.to : value;
  // useOptimistic shows the new value at once and drops back to `effective` by
  // itself when the transition ends without a confirmed save (a failed save).
  const [shown, setShown] = React.useOptimistic(effective);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (n: number) => {
    if (pending) return;
    const next = n === shown ? null : n; // the current star again clears it
    setError(null);
    startTransition(async () => {
      setShown(next);
      let result: Awaited<ReturnType<typeof setRequirementRating>>;
      try {
        result = await setRequirementRating(requirementId, next);
      } catch {
        result = { ok: false, error: "Could not save the rating. Try again." };
      }
      if (!result.ok) setError(result.error);
      else setConfirmed({ from: value, to: next });
    });
  };

  const move = (to: number) => refs.current[to - 1]?.focus();

  const onKeyDown = (e: React.KeyboardEvent, n: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(n === 5 ? 1 : n + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(n === 1 ? 5 : n - 1);
        break;
      case "Home":
        e.preventDefault();
        move(1);
        break;
      case "End":
        e.preventDefault();
        move(5);
        break;
    }
  };

  // One tab stop: the chosen star, or the first when nothing is chosen.
  const tabStop = shown ?? 1;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-x-2">
        <div
          role="radiogroup"
          aria-label="Listing rating"
          aria-busy={pending}
          className="-ml-2 inline-flex items-center"
        >
          {STARS.map((n) => {
            const checked = shown === n;
            return (
              <button
                key={n}
                ref={(el) => {
                  refs.current[n - 1] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={`${n} stars: ${ratingLabel(n)}`}
                tabIndex={n === tabStop ? 0 : -1}
                aria-disabled={pending}
                onClick={() => choose(n)}
                onKeyDown={(e) => onKeyDown(e, n)}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-wait aria-disabled:opacity-60"
              >
                <Star
                  aria-hidden="true"
                  className={cn("h-6 w-6", shown != null && n <= shown ? FILLED : EMPTY)}
                />
              </button>
            );
          })}
        </div>
        <span className="text-sm text-foreground" aria-live="polite">
          {ratingLabel(shown)}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
