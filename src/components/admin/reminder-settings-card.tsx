"use client";

import * as React from "react";
import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Label } from "@/components/ui/label";
import { LocalDateTime } from "@/components/local-date-time";
import { Select } from "@/components/ui/select";
import { saveReminderSettingsAction } from "@/lib/actions/reminder-settings";
import type { FormState } from "@/lib/actions/types";
import { INTERVAL_OPTIONS, describeSetting, type ReminderSettings } from "@/lib/reminder-settings";
import { cn } from "@/lib/utils";

export function ReminderSettingsCard({ settings }: { settings: ReminderSettings }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveReminderSettingsAction,
    {},
  );
  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [interval, setInterval] = React.useState(String(settings.intervalMinutes));

  return (
    <CollapsibleCard
      title="Reminders"
      description={describeSetting(settings)}
      defaultOpen
    >
      <form action={action} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reminders cover deal reminders and task due dates. They are checked every minute and
          sent at the interval you choose. Turning reminders on does not send old overdue items.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              role="switch"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                enabled ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all",
                  enabled ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </span>
            <span className="text-sm font-medium">Send reminders</span>
          </label>
          <span className="rounded-md border px-2 py-0.5 text-xs font-medium">
            {enabled ? "On" : "Off"}
          </span>
        </div>

        <div className="max-w-xs space-y-2">
          <Label htmlFor="reminder_interval">How often</Label>
          <Select
            id="reminder_interval"
            name="interval_minutes"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.minutes} value={String(o.minutes)}>
                {o.label}
              </option>
            ))}
          </Select>
          {!enabled ? (
            <p className="text-xs text-muted-foreground">
              Reminders are off. The interval applies when you turn them on.
            </p>
          ) : null}
        </div>

        <p className="text-sm">
          <span className="text-muted-foreground">Last run: </span>
          {settings.lastRunAt ? <LocalDateTime iso={settings.lastRunAt} /> : "Not yet"}
        </p>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.message ? (
          <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </CollapsibleCard>
  );
}
