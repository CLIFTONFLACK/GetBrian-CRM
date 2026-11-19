-- 0047: per-agency switch and interval for the due-reminder cron.
--
-- WHAT IT DOES
-- /api/cron/due is called by Vercel every minute (vercel.json). A Vercel cron
-- cannot be changed from the app, so the route reads this table to decide, for
-- each agency, whether a run is due. One row per agency:
--   enabled          reminders on or off (default off)
--   interval_minutes how often reminders are sent (1, 5, 15, 30, 60 or 1440)
--   enabled_since    when reminders were last switched on. Only items due at or
--                    after this moment are sent, so switching on never floods
--                    people with old overdue items.
--   last_run_at      when the cron last claimed this agency (the atomic claim
--                    in claimDueAgencies stamps it)
--   updated_at / updated_by   who changed the setting, and when
--
-- A MISSING ROW MEANS OFF. This migration inserts no row, so every agency
-- starts OFF. A row is created only when an admin saves the Reminders card.
--
-- DEPLOY ORDER
-- Apply this migration BEFORE the code goes live. The new cron route reads the
-- table on every call; against the old schema it fails with "relation does not
-- exist". Old code never reads the table, so old code against the new schema is
-- safe.
--
-- No RLS and no grants: this app isolates tenants in the application layer
-- (see 0029_tasks.sql, 0019_agency_settings.sql and AGENTS.md).
--
-- Idempotent: safe to run twice. No begin/commit inside; the runner decides.

create table if not exists public.reminder_settings (
  agency_id        uuid primary key references public.agencies(id) on delete cascade,
  enabled          boolean not null default false,
  interval_minutes integer not null default 15,
  enabled_since    timestamptz,
  last_run_at      timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.users(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reminder_settings_interval_minutes_check'
      and conrelid = 'public.reminder_settings'::regclass
  ) then
    alter table public.reminder_settings
      add constraint reminder_settings_interval_minutes_check
      check (interval_minutes in (1, 5, 15, 30, 60, 1440));
  end if;
end
$$;
