-- ─────────────────────────────────────────────────────────────────────────────
-- Dummy data — 2 MANAGER-role users for the shared "CDG demo" agency.   NOT a
-- migration — run on demand AFTER 0011_manager_role.sql has committed (the
-- 'manager' enum value must already exist):
--   psql "$STORAGE_CRM_DATABASE_URL" -f supabase/seeds/dummy_managers.sql
--
-- Logins:  agent4@slc.test (Daniel Goldberg) · agent5@slc.test (Rachel Stein)
--          password: Demo!2026   ·   role: manager
--
-- ADAPTED FROM SUPABASE: same auth.users/auth.identities → public.users fix as
-- dummy_data.sql — see that file's header note for the full rationale.
--
-- Idempotent + tenant-isolated: only touches the demo agency and these 2 users.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  demo_agency uuid;
  uid uuid;
  i   int;
  emails text[] := array['agent4@slc.test','agent5@slc.test'];
  fulln  text[] := array['Daniel Goldberg','Rachel Stein'];
  pw     text   := 'Demo!2026';
begin
  select id into demo_agency from public.agencies where name = 'CDG demo' limit 1;
  if demo_agency is null then
    raise exception 'CDG demo agency not found — run dummy_data.sql first.';
  end if;

  for i in 1..2 loop
    select id into uid from public.users where email = emails[i];
    if uid is null then
      uid := gen_random_uuid();
      insert into public.users (id, email, password_hash, full_name)
        values (uid, emails[i], crypt(pw, gen_salt('bf')), fulln[i]);
    end if;

    -- Safety net: no signup trigger creates a personal agency anymore (see
    -- dummy_data.sql's header note) — this only matters if a stray membership
    -- was created some other way.
    delete from public.agencies a
     where a.id <> demo_agency
       and a.id in (select agency_id from public.agency_members where user_id = uid);

    insert into public.agency_members (agency_id, user_id, role)
      values (demo_agency, uid, 'manager'::public.member_role)
      on conflict (agency_id, user_id) do update set role = 'manager'::public.member_role;
  end loop;

  raise notice 'Manager seed complete: 2 managers added to agency %.', demo_agency;
end $$;
