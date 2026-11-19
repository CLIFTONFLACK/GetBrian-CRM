// Pure helpers for the per-agency reminder switch (no database access).
// The table is db/migrations/0047_reminder_settings.sql. The cron route
// /api/cron/due decides per agency with isRunDue, and the SQL in
// claimDueAgencies (queries/reminder-settings.ts) uses the same rule and the
// same slack. Change both together.

export const INTERVAL_OPTIONS = [
  { minutes: 1, label: "Every minute" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 1440, label: "Once a day" },
] as const;

export const DEFAULT_INTERVAL = 15;

/** A cron that fires at minute boundaries can arrive a few seconds early. */
export const RUN_SLACK_SECONDS = 30;

export type ReminderSettings = {
  enabled: boolean;
  intervalMinutes: number;
  enabledSince: string | null;
  lastRunAt: string | null;
};

export const OFF_SETTINGS: ReminderSettings = {
  enabled: false,
  intervalMinutes: DEFAULT_INTERVAL,
  enabledSince: null,
  lastRunAt: null,
};

/** The interval as a number if it is an allowed value, else null. */
export function parseInterval(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return INTERVAL_OPTIONS.some((o) => o.minutes === n) ? n : null;
}

/** Is a run due? Disabled is never due. No earlier run is always due. */
export function isRunDue(
  s: { enabled: boolean; intervalMinutes: number; lastRunAt: Date | null },
  now: Date,
): boolean {
  if (!s.enabled) return false;
  if (s.lastRunAt === null) return true;
  const elapsedMs = now.getTime() - s.lastRunAt.getTime();
  return elapsedMs >= s.intervalMinutes * 60_000 - RUN_SLACK_SECONDS * 1000;
}

export function intervalLabel(minutes: number): string {
  return INTERVAL_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `Every ${minutes} minutes`;
}

/** One line for the UI: the state and, when on, the interval. */
export function describeSetting(s: { enabled: boolean; intervalMinutes: number }): string {
  return s.enabled
    ? `Reminders are on. ${intervalLabel(s.intervalMinutes)}.`
    : "Reminders are off";
}
