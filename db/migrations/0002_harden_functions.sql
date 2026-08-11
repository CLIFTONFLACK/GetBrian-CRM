-- Phase 1 hardening (from Supabase security advisor)
--
-- ADAPTED FROM SUPABASE: the original file revoked PostgREST RPC execute
-- grants on seed_agency()/handle_new_user()/auth_agency_ids()/is_agency_admin()
-- — all four are dropped in 0001 on this adapted set, so nothing here applies
-- to them anymore. The covering indexes for foreign-key joins (advisor:
-- unindexed_foreign_keys) are ordinary schema changes and are kept as-is.

create index if not exists deals_listing_idx        on public.deals(listing_id);
create index if not exists deals_requirement_idx    on public.deals(requirement_id);
create index if not exists deals_company_idx         on public.deals(company_id);
create index if not exists listings_company_idx      on public.listings(company_id);
create index if not exists requirements_contact_idx  on public.requirements(contact_id);
