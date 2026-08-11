-- Global usage count for a contact role slug. Contacts are agency-scoped, but
-- contact_roles is system-wide, so an admin's own agency view can't tell whether
-- another agency still uses a role. This helper counts across all agencies so
-- "Edit roles" can block deleting a role that is still in use anywhere.
--
-- ADAPTED FROM SUPABASE: this function never touched auth.* (no auth.uid()
-- call) — it exists to bypass per-agency Row-Level Security for a legitimate
-- cross-tenant count, not to authenticate anyone, so it survives unchanged.
-- Only the `security definer`/`set search_path` bypass-RLS boilerplate and the
-- `revoke/grant ... to anon, authenticated` lines are dropped: RLS no longer
-- exists to bypass, and `anon`/`authenticated` are Supabase PostgREST roles
-- that don't exist on plain Postgres/Neon (granting to them would error).
create or replace function public.contact_role_in_use(p_slug text)
returns integer language sql stable as $$
  select count(*)::int from public.contacts where role = p_slug;
$$;
