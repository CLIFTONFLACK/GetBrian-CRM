-- 0033: London neighbourhood / fare-zone requirement targets + leisure use classes.
--
-- Two independent changes, both additive:
--
-- 1. Requirements can now target London neighbourhoods ("Soho", "Shoreditch")
--    and Transport for London fare zones ("Zone 1"). Both are stored as plain
--    text arrays alongside the existing town/county/region/district targets and
--    resolved against the curated dataset in src/lib/locations/data.
--
-- 2. The use_class enum gains the leisure trading concepts the picker now
--    offers. Class E / A3 / A4 / A5 stay in the enum (existing rows still carry
--    them; 0034 migrates those rows) but are no longer offered on the form —
--    agents brief in trading terms, not planning terms.
--
-- The ADD VALUEs and the backfill that uses them must be in separate
-- transactions, so the data migration lives in 0034.

alter table public.requirements
  add column if not exists target_neighbourhoods text[] not null default '{}',
  add column if not exists target_london_zones text[] not null default '{}';

alter type public.use_class add value if not exists 'pub';
alter type public.use_class add value if not exists 'bar';
alter type public.use_class add value if not exists 'restaurant';
alter type public.use_class add value if not exists 'cafe';
alter type public.use_class add value if not exists 'gym';
alter type public.use_class add value if not exists 'leisure';
