-- Phase 5 — editable contact roles
-- Contact roles used to be a fixed Postgres enum (`contact_role`), so admins could
-- neither rename nor add them. This replaces the enum with a small, editable
-- lookup table so the Admin "Edit roles" card can rename/add roles. Scope is
-- system-wide (one shared list — this is effectively a single-tenant CDG CRM).
--
-- Design: `contacts.role` stores a stable `slug`; the editable `label` is
-- display-only. Renaming changes only the label, so existing contacts keep their
-- association. Custom roles get a new slug + label.
--
-- ADAPTED FROM SUPABASE: dropped is_any_agency_admin() — a SECURITY DEFINER
-- helper that resolved `auth.uid()` to decide if the caller administers any
-- agency, used only by this file's (and 0025_company_types.sql's) now-dropped
-- Row-Level Security policies. auth.uid() has no equivalent outside Supabase
-- Auth; the same "is this user an admin of some agency" check is now made by
-- the app-layer DAO/Server Action before allowing a role/type write.

create table public.contact_roles (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  label      text not null,
  sort_order int  not null default 0,
  is_system  boolean not null default false,  -- 'other' is the protected fallback
  created_at timestamptz not null default now()
);

-- Move contacts.role off the enum so custom slugs are storable. The cast keeps
-- every existing value (they are already the default slugs), and 'other' stays
-- the default. Nothing else references the enum type, so it can be dropped.
alter table public.contacts alter column role drop default;
alter table public.contacts alter column role type text using role::text;
alter table public.contacts alter column role set default 'other';
drop type public.contact_role;

-- Seed the six historical defaults. Idempotent so a re-run is safe.
insert into public.contact_roles (slug, label, sort_order, is_system) values
  ('acquisitions', 'Acquisitions', 1, false),
  ('landlord',     'Landlord',     2, false),
  ('solicitor',    'Solicitor',    3, false),
  ('agent',        'Agent',        4, false),
  ('finance',      'Finance',      5, false),
  ('other',        'Other',        6, true)
on conflict (slug) do nothing;
