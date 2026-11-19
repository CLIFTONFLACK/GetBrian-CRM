-- Verifies db/migrations/0046_requirement_location_anchor.sql after it has been applied.
-- NOT a migration: it lives in scripts/ because every file in db/migrations is
-- replayed by the runner. Run it by hand against a database that has 0046:
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/verify-0046.sql
--
-- ON_ERROR_STOP is required. Without it psql prints the error, runs the
-- rollback and exits 0, so a failed check would read as a pass to anything
-- that looks at the exit code. The only proof of success is the NOTICE
-- "verify-0046: all checks passed".
--
-- It runs inside begin ... rollback, inserts its own agency and rows, and
-- leaves nothing behind. Any failed check raises an exception with the check
-- name in the message. Every rule has a negative control: the bad value must be
-- REJECTED, and a good value next to it must be accepted, so a check that
-- rejects everything cannot pass.

begin;

do $$
declare
  a  uuid;
  r  uuid;
begin
  insert into public.agencies (name) values ('verify-0046 temp agency') returning id into a;

  -- ── the columns exist with the right types ───────────────────────────────
  if (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'requirements'
          and column_name in ('location_anchor_text', 'location_anchor_lat',
                              'location_anchor_lng', 'location_radius_miles',
                              'max_rent_psf')) <> 5 then
    raise exception 'columns: expected 5 new columns on requirements';
  end if;

  -- ── a complete anchor is accepted ────────────────────────────────────────
  insert into public.requirements
    (agency_id, title, location_anchor_text, location_anchor_lat, location_anchor_lng,
     location_radius_miles, max_rent_psf)
    values (a, 'v0046 full', 'Soho', 51.5136, -0.1365, 3, 25.5)
    returning id into r;
  if (select location_radius_miles from public.requirements where id = r) is distinct from 3 then
    raise exception 'full anchor: radius not stored';
  end if;

  -- ── text and radius with no coordinates is accepted (place not found yet) ─
  insert into public.requirements
    (agency_id, title, location_anchor_text, location_radius_miles)
    values (a, 'v0046 text only', 'Nowhere Street', 2);

  -- ── all-null is accepted (the old shape of every row) ────────────────────
  insert into public.requirements (agency_id, title) values (a, 'v0046 plain');

  -- ── coordinates: latitude without longitude is rejected ──────────────────
  begin
    insert into public.requirements (agency_id, title, location_anchor_lat)
      values (a, 'v0046 lat only', 51.5);
    raise exception 'lat without lng was accepted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.requirements (agency_id, title, location_anchor_lng)
      values (a, 'v0046 lng only', -0.1);
    raise exception 'lng without lat was accepted';
  exception when check_violation then
    null;
  end;
  -- Same rule on UPDATE: setting one half on a row that has neither.
  begin
    update public.requirements set location_anchor_lat = 51.5
      where id = (select id from public.requirements where agency_id = a and title = 'v0046 plain');
    raise exception 'update: lat without lng was accepted';
  exception when check_violation then
    null;
  end;

  -- ── radius: 0.1 and 50 accepted; 0 and 51 rejected ───────────────────────
  update public.requirements set location_radius_miles = 0.1 where id = r;
  update public.requirements set location_radius_miles = 50 where id = r;
  begin
    update public.requirements set location_radius_miles = 0 where id = r;
    raise exception 'radius 0 was accepted';
  exception when check_violation then
    null;
  end;
  begin
    update public.requirements set location_radius_miles = 51 where id = r;
    raise exception 'radius 51 was accepted';
  exception when check_violation then
    null;
  end;
  begin
    update public.requirements set location_radius_miles = -1 where id = r;
    raise exception 'radius -1 was accepted';
  exception when check_violation then
    null;
  end;
  update public.requirements set location_radius_miles = null where id = r;

  -- ── max_rent_psf: positive accepted; 0 and negative rejected ─────────────
  update public.requirements set max_rent_psf = 0.01 where id = r;
  begin
    update public.requirements set max_rent_psf = 0 where id = r;
    raise exception 'max_rent_psf 0 was accepted';
  exception when check_violation then
    null;
  end;
  begin
    update public.requirements set max_rent_psf = -5 where id = r;
    raise exception 'max_rent_psf -5 was accepted';
  exception when check_violation then
    null;
  end;
  update public.requirements set max_rent_psf = null where id = r;

  -- ── the three constraints exist by name ──────────────────────────────────
  if (select count(*) from pg_constraint
        where conrelid = 'public.requirements'::regclass
          and conname in ('requirements_location_anchor_coords',
                          'requirements_location_radius_range',
                          'requirements_max_rent_psf_positive')) <> 3 then
    raise exception 'constraints: expected 3 named constraints';
  end if;

  raise notice 'verify-0046: all checks passed';
end;
$$;

rollback;
