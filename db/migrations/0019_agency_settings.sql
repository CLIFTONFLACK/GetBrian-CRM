-- Phase 4 — per-agency settings
-- Stores the agency's OpenRouter API key + model for the AI "Deep Dive" feature
-- (entered in the Admin page) and a jsonb bag for future integration tokens.
--
-- ADAPTED FROM SUPABASE: the key is a secret, so the original restricted
-- read/write to agency admins via Row-Level Security (dropped here — the
-- app-layer DAO/Server Action now performs the same
-- `exists(select 1 from agency_members where agency_id=$1 and user_id=$2 and
-- role='admin')` check before touching this table). Also dropped
-- current_agency_openrouter(): a SECURITY DEFINER helper that resolved the
-- caller's agency via auth.uid() so non-admins could fetch the config
-- server-side without a direct table grant — auth.uid() has no equivalent
-- outside Supabase Auth, and the "resolve current user's agency, then read
-- agency_settings" logic is exactly what the DAO/Server Action layer does now
-- with an explicit agencyId parameter (judgment call — see report).

create table public.agency_settings (
  agency_id          uuid primary key references public.agencies(id) on delete cascade,
  openrouter_api_key text,
  openrouter_model   text not null default 'perplexity/sonar',
  integrations       jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

create trigger trg_agency_settings_updated before update on public.agency_settings
  for each row execute function public.set_updated_at();
