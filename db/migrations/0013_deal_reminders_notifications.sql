-- Upgrades batch — Phase 0
-- (#11) deal_reminders — deadlines / reminders attached to a deal.
--       notifications  — in-app notifications, one row per recipient user.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped on both tables (the
-- original per-user notifications policies — read/update/delete only your own,
-- insert for any agency member — are enforced application-side instead).
-- created_by/user_id now reference public.users(id).

-- ─────────────────────────────────────────────────────────────────────────────
-- Deal reminders / deadlines
-- ─────────────────────────────────────────────────────────────────────────────
create table public.deal_reminders (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  deal_id    uuid not null references public.deals(id) on delete cascade,
  title      text not null,
  due_at     timestamptz not null,
  done       boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index deal_reminders_deal_idx   on public.deal_reminders(deal_id);
create index deal_reminders_agency_idx on public.deal_reminders(agency_id, due_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- In-app notifications (per recipient). A member may create a notification for
-- any colleague in their agency; each user reads / marks-read only their own
-- (enforced application-side).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read_at);
