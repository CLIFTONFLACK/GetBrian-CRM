/**
 * One-off helper: split `cdg_listings.json` into small per-batch SQL files so each
 * can be applied via the Supabase MCP `execute_sql` tool without blowing past its
 * context-sized query limit. Same row-shape/logic as `generate-cdg-seed.ts`, just
 * chunked. Writes to `supabase/seeds/batches/` (batch_00.sql, batch_01.sql, ...)
 * plus a `_delete.sql` (run first) and `_agents.sql` (run last).
 *
 *   node scripts/gen-cdg-batches.ts [batchSize]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { DisposalInsert } from "../src/lib/disposals/cdg.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS = join(__dirname, "..", "supabase", "seeds");
const OUT_DIR = join(SEEDS, "batches");
mkdirSync(OUT_DIR, { recursive: true });

const BATCH_SIZE = Number(process.argv[2]) || 10;
const rows = JSON.parse(readFileSync(join(SEEDS, "cdg_listings.json"), "utf8")) as DisposalInsert[];

function insertSql(batch: DisposalInsert[]): string {
  const payload = JSON.stringify(batch);
  if (payload.includes("$cdg$")) throw new Error("Payload collides with the $cdg$ dollar-quote tag.");
  return `do $$
declare
  demo_agency uuid;
  member_ids  uuid[];
  lead        uuid;
  rec         jsonb;
  i           int := 0;
  payload     jsonb := $cdg$${payload}$cdg$::jsonb;
begin
  select id into demo_agency from public.agencies where name = 'CDG demo' limit 1;
  if demo_agency is null then raise exception 'Demo agency "CDG demo" not found.'; end if;

  select array_agg(user_id order by user_id) into member_ids
    from public.agency_members where agency_id = demo_agency;
  if member_ids is null or array_length(member_ids, 1) = 0 then
    raise exception 'Demo agency has no members.';
  end if;

  for rec in select * from jsonb_array_elements(payload) loop
    i := i + 1;
    select p.id into lead
      from public.profiles p
      join public.agency_members am on am.user_id = p.id
     where am.agency_id = demo_agency and p.full_name = rec->>'agent_name'
     limit 1;
    if lead is null then lead := member_ids[1 + (i % array_length(member_ids, 1))]; end if;
    insert into public.disposals (
      agency_id, source, source_ref, source_url, status, source_updated_at,
      title, summary, address_line, area, city, postcode, lat, lng,
      property_type, use_class, disposal_type, to_let, for_sale,
      rent_pa, rent_raw, rent_period, premium, premium_raw, guide_price, price_qualifier,
      vat_applicable, rateable_value, business_rates, service_charge, estate_charge, parking_charge,
      tenure_raw, lease_term_years, lease_expiry, rent_review_basis, next_rent_review, inside_1954_act,
      size_sqft, size_sqm, covers_internal, covers_external, floors,
      licensing_notes, fit_out_state, epc_rating,
      description, location_description, key_features, sections,
      agent_name, agent_email, agent_phone, agent_photo,
      images, brochure_url,
      lead_agent_id, created_by
    ) values (
      demo_agency,
      coalesce(rec->>'source', 'cdg'), rec->>'source_ref', rec->>'source_url', rec->>'status',
      (rec->>'source_updated_at')::timestamptz,
      rec->>'title', rec->>'summary', rec->>'address_line', rec->>'area', rec->>'city',
      rec->>'postcode', (rec->>'lat')::double precision, (rec->>'lng')::double precision,
      rec->>'property_type', rec->>'use_class', rec->>'disposal_type',
      (rec->>'to_let')::boolean, (rec->>'for_sale')::boolean,
      (rec->>'rent_pa')::numeric, rec->>'rent_raw', rec->>'rent_period',
      (rec->>'premium')::numeric, rec->>'premium_raw', (rec->>'guide_price')::numeric,
      rec->>'price_qualifier',
      (rec->>'vat_applicable')::boolean, (rec->>'rateable_value')::numeric,
      (rec->>'business_rates')::numeric, (rec->>'service_charge')::numeric,
      (rec->>'estate_charge')::numeric, (rec->>'parking_charge')::numeric,
      rec->>'tenure_raw', (rec->>'lease_term_years')::int, (rec->>'lease_expiry')::date,
      rec->>'rent_review_basis', (rec->>'next_rent_review')::int, (rec->>'inside_1954_act')::boolean,
      (rec->>'size_sqft')::numeric, (rec->>'size_sqm')::numeric,
      (rec->>'covers_internal')::int, (rec->>'covers_external')::int,
      coalesce(rec->'floors', '[]'::jsonb),
      rec->>'licensing_notes', rec->>'fit_out_state', rec->>'epc_rating',
      rec->>'description', rec->>'location_description',
      coalesce(array(select jsonb_array_elements_text(rec->'key_features')), '{}'::text[]),
      coalesce(rec->'sections', '[]'::jsonb),
      rec->>'agent_name', rec->>'agent_email', rec->>'agent_phone', rec->>'agent_photo',
      coalesce(rec->'images', '[]'::jsonb), rec->>'brochure_url',
      lead, lead
    );
  end loop;
end $$;
`;
}

writeFileSync(
  join(OUT_DIR, "_delete.sql"),
  `delete from public.disposals where agency_id = (select id from public.agencies where name = 'CDG demo' limit 1);\n`,
);

let n = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const file = join(OUT_DIR, `batch_${String(n).padStart(2, "0")}.sql`);
  writeFileSync(file, insertSql(batch));
  console.log(`Wrote ${file} (${batch.length} rows, ${(insertSql(batch).length / 1024).toFixed(1)} KB)`);
  n++;
}

writeFileSync(
  join(OUT_DIR, "_agents.sql"),
  `insert into public.disposal_agents (agency_id, disposal_id, user_id)
  select d.agency_id, d.id, m.user_id
    from public.disposals d
    join public.agency_members m on m.agency_id = d.agency_id
   where d.agency_id = (select id from public.agencies where name = 'CDG demo' limit 1)
     and m.user_id is distinct from d.lead_agent_id
     and random() < 0.22
  on conflict do nothing;
`,
);

console.log(`\nDone: ${n} batches + _delete.sql + _agents.sql in ${OUT_DIR}`);
