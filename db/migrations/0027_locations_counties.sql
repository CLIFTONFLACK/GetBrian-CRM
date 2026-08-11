-- 0027 (originally 0026): structured UK locations — county columns + requirement
-- location targets.
--
-- County is user-editable; when left blank the app derives it from postcode/town
-- via the bundled UK locations dataset (src/lib/locations). No backfill here on
-- purpose: legacy rows derive county at read time and persist it on next save.

alter table public.disposals  add column if not exists county text;
alter table public.contacts   add column if not exists county text;
alter table public.companies  add column if not exists county text;

alter table public.requirements
  add column if not exists target_counties text[] not null default '{}',
  add column if not exists target_postcode_districts text[] not null default '{}';

create index if not exists disposals_county_idx on public.disposals (agency_id, county);
