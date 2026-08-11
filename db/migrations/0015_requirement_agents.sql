-- Upgrades batch — #9b
-- Enquiries (requirements) gain the same agent-ownership model as companies /
-- contacts / disposals (0007): a single lead agent + many additional agents.
--
-- ADAPTED FROM SUPABASE: originally numbered 0014_requirement_agents.sql;
-- renumbered to 0015 to resolve the duplicate-0014 collision with
-- 0014_agent_socials.sql (dropped from this set — see report). FKs now target
-- public.users(id); Row-Level Security dropped.

alter table public.requirements
  add column if not exists lead_agent_id uuid references public.users(id) on delete set null;
create index if not exists requirements_lead_agent_idx on public.requirements(lead_agent_id);

create table if not exists public.requirement_agents (
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (requirement_id, user_id)
);
create index if not exists requirement_agents_agency_idx on public.requirement_agents(agency_id);
create index if not exists requirement_agents_user_idx   on public.requirement_agents(user_id);
