-- Listing primary type — every listing is either 'cdg' (CDG's own instruction) or
-- 'intel' (market intelligence gathered from elsewhere). INTEL listings render an
-- UNBRANDED PDF (no CDG logo, phone, URL or "CDG Leisure Ltd" disclaimer) and carry
-- a "Market intel — not for distribution" marker. Text + CHECK (mirrors the other
-- categorical columns on `disposals`, which are text, not enums).

alter table public.disposals
  add column if not exists listing_type text not null default 'cdg';

do $$ begin
  alter table public.disposals
    add constraint disposals_listing_type_chk check (listing_type in ('cdg', 'intel'));
exception when duplicate_object then null; end $$;
