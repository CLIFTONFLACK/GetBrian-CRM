import { sql } from "@/lib/db/client";
import { OFF_SETTINGS, type ReminderSettings } from "@/lib/reminder-settings";

// DAO for public.reminder_settings (db/migrations/0047_reminder_settings.sql).
// Row type is local, on purpose: src/lib/database.types.ts is shared with other
// work. A missing row means OFF.

type SettingsRow = {
  enabled: boolean;
  interval_minutes: number;
  enabled_since: string | null;
  last_run_at: string | null;
};

/** The agency's reminder settings. No row means reminders are off. */
export async function getReminderSettings(agencyId: string): Promise<ReminderSettings> {
  const rows = (await sql`
    select enabled, interval_minutes, enabled_since::text as enabled_since,
           last_run_at::text as last_run_at
    from public.reminder_settings
    where agency_id = ${agencyId}
    limit 1
  `) as SettingsRow[];
  const r = rows[0];
  if (!r) return { ...OFF_SETTINGS };
  return {
    enabled: r.enabled,
    intervalMinutes: r.interval_minutes,
    enabledSince: r.enabled_since,
    lastRunAt: r.last_run_at,
  };
}

/**
 * Upsert. Turning reminders ON (false to true, or a first insert with enabled
 * true) sets enabled_since = now() and clears last_run_at, so the first run
 * happens at the next cron call and only covers items due from now on. Turning
 * OFF leaves enabled_since as it was. The caller has already checked that the
 * user is an admin of agencyId and validated the interval.
 */
export async function saveReminderSettings(
  agencyId: string,
  userId: string,
  input: { enabled: boolean; intervalMinutes: number },
): Promise<void> {
  await sql`
    insert into public.reminder_settings
      (agency_id, enabled, interval_minutes, enabled_since, last_run_at, updated_at, updated_by)
    values
      (${agencyId}, ${input.enabled}, ${input.intervalMinutes},
       case when ${input.enabled}::boolean then now() else null end, null, now(), ${userId})
    on conflict (agency_id) do update set
      enabled_since = case
        when excluded.enabled and not public.reminder_settings.enabled then now()
        else public.reminder_settings.enabled_since end,
      last_run_at = case
        when excluded.enabled and not public.reminder_settings.enabled then null
        else public.reminder_settings.last_run_at end,
      enabled = excluded.enabled,
      interval_minutes = excluded.interval_minutes,
      updated_at = now(),
      updated_by = excluded.updated_by
  `;
}

/**
 * Claims, in ONE statement, every agency whose reminder run is due, and stamps
 * last_run_at. The UPDATE takes a row lock, so two overlapping cron calls
 * cannot both claim the same agency: the second one re-checks the condition
 * after the first commits and finds it no longer due. The rule is the same as
 * isRunDue in src/lib/reminder-settings.ts (30 second slack), on the database
 * clock. An agency is claimed even when the run later fails: it is retried at
 * the next interval, and items stay unstamped so nothing is lost.
 */
export async function claimDueAgencies(): Promise<
  { agencyId: string; enabledSince: string | null }[]
> {
  const rows = (await sql`
    update public.reminder_settings set last_run_at = now()
    where enabled
      and (last_run_at is null
           or now() - last_run_at >= make_interval(mins => interval_minutes) - interval '30 seconds')
    returning agency_id, enabled_since::text as enabled_since
  `) as { agency_id: string; enabled_since: string | null }[];
  return rows.map((r) => ({ agencyId: r.agency_id, enabledSince: r.enabled_since }));
}

/**
 * Gives a claim back after a failed run: clears last_run_at so the next cron
 * call (a minute later) tries again instead of waiting a whole interval, which
 * could be a day. Only while the agency is still switched on.
 */
export async function releaseClaim(agencyId: string): Promise<void> {
  await sql`
    update public.reminder_settings set last_run_at = null
    where agency_id = ${agencyId}::uuid and enabled
  `;
}
