-- 0046: a requirement can be "within N miles of a place", and it can carry a
-- maximum rent per square foot.
--
-- WHY
-- Agents write "within 3 miles of Soho" and "up to £25 per sq ft". Neither fits
-- the existing columns: the target_* arrays name places but have no radius, and
-- max_rent is an ANNUAL total. The Kato import used to leave both in notes.
--
-- New columns on public.requirements (all nullable, no defaults):
--   location_anchor_text   the place as written ("Soho", "34 Russell Street, Covent Garden")
--   location_anchor_lat    its latitude  (null until the place has been resolved)
--   location_anchor_lng    its longitude (null until the place has been resolved)
--   location_radius_miles  the radius, 0.1 to 50 miles
--   max_rent_psf           the most the client will pay per sq ft per year
--
-- Checks (each added once, guarded by a pg_constraint test like 0044):
--   - latitude and longitude are both null or both set, never one alone;
--   - radius is null or between 0.1 and 50;
--   - max_rent_psf is null or above 0.
-- A row with text and a radius but no coordinates is allowed on purpose: the
-- place could not be found. Matching ignores such an anchor (it needs lat, lng
-- and radius together), and the screens show a warning.
--
-- DEPLOY ORDER
-- Apply this migration BEFORE the code that selects the new columns goes live.
-- New code against the old schema fails every requirement read with "column
-- does not exist". Old code against the new schema is safe: it never selects
-- or writes the new columns, and adding nullable columns does not touch the
-- date_updated trigger from 0044 (no existing row changes).
--
-- Idempotent: safe to run twice. No begin/commit here; the runner wraps the file.

alter table public.requirements add column if not exists location_anchor_text  text;
alter table public.requirements add column if not exists location_anchor_lat   double precision;
alter table public.requirements add column if not exists location_anchor_lng   double precision;
alter table public.requirements add column if not exists location_radius_miles numeric(5,2);
alter table public.requirements add column if not exists max_rent_psf          numeric(8,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_location_anchor_coords'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_location_anchor_coords
      check ((location_anchor_lat is null) = (location_anchor_lng is null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_location_radius_range'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_location_radius_range
      check (location_radius_miles is null
             or location_radius_miles between 0.1 and 50);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_max_rent_psf_positive'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_max_rent_psf_positive
      check (max_rent_psf is null or max_rent_psf > 0);
  end if;
end;
$$;
