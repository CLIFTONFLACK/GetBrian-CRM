-- 0035 (originally 0034): migrate existing requirement briefs onto the new
-- use-class / tenure sets.
--
-- The picker no longer offers Class E, A3, A4, A5, Assignment or New letting, so
-- rows still carrying them would silently lose those criteria the next time an
-- agent saved the brief. Map them across instead:
--
--   sui_generis_pub_bar -> pub + bar          (the combined option is now split)
--   A4                  -> pub + bar
--   A3                  -> restaurant
--   A5                  -> sui_generis_hot_food
--   E                   -> restaurant + cafe + gym   (Class E's leisure sub-uses)
--   assignment          -> leasehold          (leasehold now covers assignments)
--   new_letting         -> leasehold
--
-- Values are de-duplicated and sorted, which also makes this migration a no-op
-- on a second run. `property_types` and `fit_out_prefs` are deliberately left
-- untouched: those fields leave the form in this batch, but the stored data is
-- kept rather than destroyed.

with mapped as (
  select
    r.id,
    (
      select array_agg(distinct v order by v)
      from unnest(r.use_classes) as u
      cross join lateral unnest(
        case u::text
          when 'sui_generis_pub_bar' then array['pub', 'bar']
          when 'A4' then array['pub', 'bar']
          when 'A3' then array['restaurant']
          when 'A5' then array['sui_generis_hot_food']
          when 'E' then array['restaurant', 'cafe', 'gym']
          else array[u::text]
        end
      ) as t(v)
    ) as vals
  from public.requirements r
  where coalesce(array_length(r.use_classes, 1), 0) > 0
)
update public.requirements r
set use_classes = m.vals::public.use_class[]
from mapped m
where r.id = m.id
  and m.vals is not null
  and m.vals::public.use_class[] is distinct from r.use_classes;

with mapped as (
  select
    r.id,
    (
      select array_agg(distinct v order by v)
      from unnest(r.tenure_prefs) as t
      cross join lateral (
        select case t::text
          when 'assignment' then 'leasehold'
          when 'new_letting' then 'leasehold'
          else t::text
        end
      ) as x(v)
    ) as vals
  from public.requirements r
  where coalesce(array_length(r.tenure_prefs, 1), 0) > 0
)
update public.requirements r
set tenure_prefs = m.vals::public.tenure_type[]
from mapped m
where r.id = m.id
  and m.vals is not null
  and m.vals::public.tenure_type[] is distinct from r.tenure_prefs;
