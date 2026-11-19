-- Verifies db/migrations/0047_reminder_settings.sql after it has been applied.
-- NOT a migration: it lives in scripts/ because every file in db/migrations is
-- replayed by the runner. Run it by hand against a database that has 0047:
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/verify-0047.sql
--
-- ON_ERROR_STOP is required. Without it psql prints the error, runs the
-- rollback and exits 0, so a failed check would read as a pass. The only proof
-- of success is the NOTICE "verify-0047: all checks passed".
--
-- It runs inside begin ... rollback, makes its own agency and user, and leaves
-- nothing behind. Any failed check raises an exception with the check name.

begin;

do $$
declare
  a  uuid;
  u  uuid;
  n  integer;
  e  boolean;
  m  integer;
  ok boolean;
  v  integer;
begin
  insert into public.agencies (name) values ('verify-0047 temp agency') returning id into a;
  insert into public.users (email, password_hash)
    values ('verify-0047@example.invalid', 'not-a-real-hash') returning id into u;

  -- Defaults: a bare insert is OFF, every 15 minutes, no stamps.
  insert into public.reminder_settings (agency_id) values (a);
  select enabled, interval_minutes into e, m from public.reminder_settings where agency_id = a;
  if e is distinct from false then raise exception 'default enabled is not false (%)', e; end if;
  if m is distinct from 15 then raise exception 'default interval is not 15 (%)', m; end if;
  if (select enabled_since from public.reminder_settings where agency_id = a) is not null then
    raise exception 'enabled_since is not null by default';
  end if;
  if (select last_run_at from public.reminder_settings where agency_id = a) is not null then
    raise exception 'last_run_at is not null by default';
  end if;

  -- Every allowed interval is accepted.
  foreach v in array array[1, 5, 15, 30, 60, 1440] loop
    update public.reminder_settings set interval_minutes = v where agency_id = a;
    select interval_minutes into m from public.reminder_settings where agency_id = a;
    if m is distinct from v then raise exception 'allowed interval % was not stored', v; end if;
  end loop;

  -- Negative controls: 7 and 0 must be rejected. If either is accepted the
  -- constraint is missing and this check fails loudly.
  foreach v in array array[7, 0] loop
    ok := false;
    begin
      update public.reminder_settings set interval_minutes = v where agency_id = a;
    exception when check_violation then
      ok := true;
    end;
    if not ok then raise exception 'interval % was accepted', v; end if;
  end loop;

  -- The stored value is untouched after the rejected updates.
  select interval_minutes into m from public.reminder_settings where agency_id = a;
  if m is distinct from 1440 then raise exception 'interval changed after rejected updates (%)', m; end if;

  -- Re-applying the constraint guard is a no-op (idempotence of the DO block).
  select count(*) into n from pg_constraint
    where conname = 'reminder_settings_interval_minutes_check'
      and conrelid = 'public.reminder_settings'::regclass;
  if n <> 1 then raise exception 'expected exactly one interval constraint, found %', n; end if;

  -- updated_by is nulled when the user is deleted.
  update public.reminder_settings set updated_by = u where agency_id = a;
  delete from public.users where id = u;
  if (select updated_by from public.reminder_settings where agency_id = a) is not null then
    raise exception 'updated_by was not nulled when the user was deleted';
  end if;

  -- Deleting the agency removes its row (on delete cascade).
  delete from public.agencies where id = a;
  select count(*) into n from public.reminder_settings where agency_id = a;
  if n <> 0 then raise exception 'row survived deletion of its agency (%)', n; end if;

  raise notice 'verify-0047: all checks passed';
end;
$$;

rollback;
