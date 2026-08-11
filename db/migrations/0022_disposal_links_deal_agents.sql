-- Next-session feature batch — relational links + deal ownership
--   #1/#4: link a disposal (listing) to a Company (e.g. landlord/vendor) and a
--          Contact, so listings surface on company cards and a listing can show
--          its point-of-contact.
--   #6:    give deals a lead agent + additional-agent collaborators, mirroring
--          the companies/contacts/disposals pattern from 0007.
--
-- ADAPTED FROM SUPABASE: Row-Level Security dropped; lead_agent_id/user_id now
-- reference public.users(id).

-- ─────────────────────────────────────────────────────────────────────────────
-- #1 / #4 — disposal ↔ company / contact (nullable, cleared if the row is gone)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.disposals
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists disposals_company_idx on public.disposals(company_id);
create index if not exists disposals_contact_idx on public.disposals(contact_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- #6 — deal lead agent + additional agents
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.deals
  add column if not exists lead_agent_id uuid references public.users(id) on delete set null;
create index if not exists deals_lead_agent_idx on public.deals(lead_agent_id);

create table if not exists public.deal_agents (
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  deal_id    uuid not null references public.deals(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
create index if not exists deal_agents_agency_idx on public.deal_agents(agency_id);
create index if not exists deal_agents_user_idx   on public.deal_agents(user_id);
