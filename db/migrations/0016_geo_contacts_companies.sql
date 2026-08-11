-- Phase 2 — geocoding for contacts & companies
-- Adds postal address + lat/lng to contacts and companies so they can be geocoded
-- (Google Geocoding API) and plotted on the concentration heatmap alongside
-- listings. The `disposals` table already carries address + lat/lng, so it is
-- untouched here. All columns are nullable — existing rows stay valid and the
-- app fails soft when no address/key is present.

alter table public.contacts add column if not exists address_line text;
alter table public.contacts add column if not exists city text;
alter table public.contacts add column if not exists postcode text;
alter table public.contacts add column if not exists lat double precision;
alter table public.contacts add column if not exists lng double precision;

alter table public.companies add column if not exists address_line text;
alter table public.companies add column if not exists city text;
alter table public.companies add column if not exists postcode text;
alter table public.companies add column if not exists lat double precision;
alter table public.companies add column if not exists lng double precision;
