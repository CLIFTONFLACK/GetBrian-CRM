-- Comms & tasks batch — tasks + firing reminders groundwork
--   tasks                    — standalone to-dos with an optional assignee, due
--                              date and entity link ("record not action" fix).
--   deal_reminders.notified_at — stamped by the due-date cron so each reminder
--                              only fires one notification.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; assignee_id/created_by now
-- reference public.users(id). Dropped the
-- `alter publication supabase_realtime add table public.notifications` — the
-- `supabase_realtime` logical-replication publication is created by Supabase's
-- own infrastructure and doesn't exist on plain Postgres/Neon, so this would
-- error on a fresh apply (judgment call — see report; the notifications bell
-- needs a different live-update mechanism going forward, out of scope here).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tasks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  title       text not null,
  details     text,
  due_at      timestamptz,
  assignee_id uuid references public.users(id) on delete set null,
  entity_type text,
  entity_id   uuid,
  status      text not null default 'open' check (status in ('open', 'done')),
  notified_at timestamptz,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_agency_status_due_idx on public.tasks(agency_id, status, due_at);
create index if not exists tasks_assignee_status_idx   on public.tasks(assignee_id, status);

do $$ begin
  create trigger trg_tasks_updated before update on public.tasks
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deal reminders — one-shot cron notification stamp
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.deal_reminders add column if not exists notified_at timestamptz;
