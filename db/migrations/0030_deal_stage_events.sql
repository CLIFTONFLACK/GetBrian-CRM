-- Deal-making fixes batch — stage history + expected close
--   deal_stage_events — one row per stage transition (including the initial
--   insert, from_stage null), written best-effort by the deal actions. Powers
--   time-in-stage ("in stage Xd"), "Stuck" board badges and funnel reporting.
--   deals.expected_close — target completion date shown on board cards
--   (red when past) and edited on the deal detail form.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; changed_by now references
-- public.users(id).

alter table public.deals
  add column if not exists expected_close date;

create table if not exists public.deal_stage_events (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  deal_id    uuid not null references public.deals(id) on delete cascade,
  from_stage public.deal_stage,
  to_stage   public.deal_stage not null,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists deal_stage_events_deal_idx
  on public.deal_stage_events(deal_id, created_at);
create index if not exists deal_stage_events_agency_idx
  on public.deal_stage_events(agency_id);
