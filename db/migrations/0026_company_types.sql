-- Editable company types — mirrors 0023_contact_roles. Company types used to be a
-- fixed Postgres enum (`company_type`), so admins could neither rename nor add them.
-- This replaces the enum with a small, editable, system-wide lookup table so the
-- Admin "Edit company types" card can rename/add types.
--
-- Design: `companies.type` stores a stable `slug`; the editable `label` is
-- display-only. Renaming changes only the label, so existing companies keep their
-- association. Custom types get a new slug + label.
--
-- ADAPTED FROM SUPABASE: Row-Level Security (which called the now-dropped
-- is_any_agency_admin(), see 0023) is dropped — the app-layer DAO/Server Action
-- makes the same admin check before a write. company_type_in_use() kept for the
-- same reason as contact_role_in_use() in 0024 (no auth.* dependency, just a
-- legitimate cross-tenant count) — only the RLS-bypass boilerplate and the
-- anon/authenticated grants are dropped.

create table public.company_types (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  sort_order int  not null default 0,
  is_system  boolean not null default false,  -- 'other' is the protected fallback
  created_at timestamptz not null default now()
);

-- Move companies.type off the enum so custom slugs are storable. The cast keeps
-- every existing value (they are already the default slugs). Nothing else
-- references the enum type, so it can be dropped.
alter table public.companies alter column type drop default;
alter table public.companies alter column type type text using type::text;
alter table public.companies alter column type set default 'other';
drop type public.company_type;

-- Seed the five historical defaults. Idempotent so a re-run is safe.
insert into public.company_types (slug, label, sort_order, is_system) values
  ('operator', 'Operator', 1, false),
  ('landlord', 'Landlord', 2, false),
  ('agent',    'Agent',    3, false),
  ('vendor',   'Vendor',   4, false),
  ('other',    'Other',    5, true)
on conflict (slug) do nothing;

-- Global usage count for a company-type slug (see 0024_contact_role_usage.sql
-- for why this survives without SECURITY DEFINER / anon-authenticated grants).
create or replace function public.company_type_in_use(p_slug text)
returns integer language sql stable as $$
  select count(*)::int from public.companies where type = p_slug;
$$;
