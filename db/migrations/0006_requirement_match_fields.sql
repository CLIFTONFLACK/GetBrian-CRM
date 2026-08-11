-- Complete the requirement (acquisition brief) matching criteria so every field
-- maps to a disposal column for the Phase 5 matching engine. Additive + safe.
alter table public.requirements
  add column if not exists property_types  text[]  not null default '{}',
  add column if not exists max_guide_price  numeric,
  add column if not exists fit_out_prefs    text[]  not null default '{}';

comment on column public.requirements.property_types  is 'Wanted property types (free text) -> disposals.property_type';
comment on column public.requirements.max_guide_price is 'Max purchase budget -> disposals.guide_price (freeholds)';
comment on column public.requirements.fit_out_prefs   is 'fully_fitted|part_fitted|shell -> disposals.fit_out_state';
