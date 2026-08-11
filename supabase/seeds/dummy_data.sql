-- ─────────────────────────────────────────────────────────────────────────────
-- Dummy data for manual/QA testing.   NOT a migration — run on demand:
--   psql "$STORAGE_CRM_DATABASE_URL" -f supabase/seeds/dummy_data.sql
--
-- ADAPTED FROM SUPABASE: the original wrote auth.users + auth.identities (a
-- Supabase-Auth-schema-specific insert) and then a separate public.profiles
-- upsert for full_name/phone/linkedin_url. Plain Postgres has neither —
-- public.users (db/migrations/0001_init.sql) already merges auth.users and
-- profiles into one table, so this version does one insert (or update) into
-- public.users per agent, with password_hash written via pgcrypto's
-- crypt()/gen_salt('bf') (bcrypt — verifiable by bcryptjs's compare(), same
-- as an Auth.js-written hash). There is also no signup trigger anymore (the
-- old "spin up a personal agency per new user" behavior was a DB trigger on
-- auth.users; it's now explicit code in the sign-up Server Action, which this
-- script never calls), so step 3 below is a no-op safety net, not a real fixup.
--
-- Creates ONE shared demo agency ("CDG demo") with 6 login-capable agents —
-- the real CDG Leisure team (Morris Greenberg, Sammy Weinbaum, Salvatore Di
-- Natale, David Kornbluth, Natasha Grech, Sophia Valenzuela), with real
-- cdgleisure.com emails / phone / LinkedIn — plus 50 companies and 75 contacts.
-- Every record gets a random lead agent; a random subset of the other agents
-- are attached as additional agents.
--
-- Disposals (the real CDG property book) are loaded separately by cdg_listings.sql,
-- which owns the demo agency's supply. Run that AFTER this file.
--
-- Idempotent + tenant-isolated: it only ever touches the demo agency and its 6
-- agents, and fully resets its companies/contacts on each run (safe to re-run any
-- time, and safe alongside other sessions — it never modifies real/other-agency
-- rows, and it leaves the CDG disposals seeded by cdg_listings.sql untouched).
--
-- The 6 agents log in with their real cdgleisure.com email / Demo!2026
-- (Morris Greenberg = admin; the rest are agents).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  demo_agency uuid;
  agent_ids   uuid[] := '{}';
  company_ids uuid[] := '{}';
  company_lats double precision[] := '{}';
  company_lngs double precision[] := '{}';
  company_cities text[] := '{}';
  pidx int;
  clat double precision;
  clng double precision;
  cplace text;
  uid uuid;
  cid uuid;
  j   int;
  i   int;

  -- The real CDG Leisure team (agent1 = Morris = admin), real cdgleisure.com logins.
  emails    text[] := array['morris@cdgleisure.com','sammy@cdgleisure.com','salvatore@cdgleisure.com',
                            'davidk@cdgleisure.com','natasha@cdgleisure.com','sophia@scrollersocial.com'];
  fulln     text[] := array['Morris Greenberg','Sammy Weinbaum','Salvatore Di Natale',
                            'David Kornbluth','Natasha Grech','Sophia Valenzuela'];
  phones    text[] := array['0207 100 5520','0207 100 5520','0207 100 5520',
                            '0207 100 5520','0207 100 5520','0207 100 5520'];
  linkedins text[] := array[null,'https://www.linkedin.com/in/sammy-weinbaum-84298a26/',null,
                            null,'https://www.linkedin.com/in/natasha-grech-114851a2/',
                            'https://www.linkedin.com/in/sophiavalenzuela/']::text[];
  pw        text := 'Demo!2026';

  -- companies.type is plain text now (types are editable data — see 0025); these are the seeded default slugs.
  ctypes  text[] := array['operator','landlord','agent','vendor','other'];
  -- contacts.role is plain text now (roles are editable data — see 0021); these are the seeded default slugs.
  croles  text[] := array['acquisitions','landlord','solicitor','agent','finance','other'];
  places  text[] := array['Riverside','Camden','Soho','Shoreditch','Mayfair','Brixton','Clapham',
                          'Islington','Hackney','Greenwich','Notting Hill','Fulham','Chelsea',
                          'Peckham','Dalston','Wapping','Bermondsey','Ealing','Richmond','Croydon'];
  -- District centroids aligned index-for-index with `places`, so every company
  -- (and its contacts) lands on the London area named in the company name and
  -- shows up on the concentration map.
  place_lats double precision[] := array[51.5060,51.5390,51.5137,51.5266,51.5096,51.4613,51.4626,
                          51.5362,51.5450,51.4826,51.5090,51.4800,51.4870,
                          51.4740,51.5460,51.5040,51.4980,51.5130,51.4610,51.3760];
  place_lngs double precision[] := array[-0.1170,-0.1426,-0.1340,-0.0799,-0.1476,-0.1156,-0.1387,
                          -0.1030,-0.0553,-0.0077,-0.1960,-0.1950,-0.1690,
                          -0.0690,-0.0750,-0.0570,-0.0640,-0.3050,-0.3040,-0.0980];
  concepts text[] := array['Taverns','Estates','Leisure','Hospitality','Inns','Brewing Co','Bars',
                           'Kitchens','Pubs','Group','Holdings','Ventures','Dining','Properties','Capital'];
  suffixes text[] := array['Ltd','LLP','Group','& Co',''];
  tags    text[] := array['pub','bar','restaurant','nightclub','hotel','cafe','brewery','cinema','gym'];

  firstn  text[] := array['James','Priya','Sarah','Tom','Aisha','Liam','Chloe','Raj','Emma','Noah',
                          'Grace','Ben','Maya','Leo','Hannah','Sam','Zoe','Adam','Ruby','Jack'];
  lastn   text[] := array['Hartley','Nair','Coombes','Wallace','Khan','Doyle','Fletcher','Mehta',
                          'Bishop','Ramsey','Greco','Okafor','Lambert','Power','Sturgess','Vale',
                          'Ashby','Quinn','Renshaw','Maddox'];
begin
  -- 1. Shared demo agency (find-or-create) ───────────────────────────────────
  select id into demo_agency from public.agencies where name = 'CDG demo' limit 1;
  if demo_agency is null then
    insert into public.agencies (name) values ('CDG demo') returning id into demo_agency;
  end if;

  -- 2. Six login-capable agents (the real CDG team) ───────────────────────────
  for i in 1..6 loop
    select id into uid from public.users where email = emails[i];
    if uid is null then
      uid := gen_random_uuid();
      insert into public.users (id, email, password_hash, full_name, phone, linkedin_url)
        values (uid, emails[i], crypt(pw, gen_salt('bf')), fulln[i], phones[i], linkedins[i]);
    else
      -- Reseed also re-asserts password_hash (not just contact details): this
      -- file's own contract is "log in with Demo!2026", and an email can
      -- already exist from an unrelated manual sign-up test with some other
      -- password (seen live for morris@cdgleisure.com) — a reseed must still
      -- leave the documented demo credentials working.
      update public.users
         set password_hash = crypt(pw, gen_salt('bf')),
             full_name = fulln[i], phone = phones[i], linkedin_url = linkedins[i], updated_at = now()
       where id = uid;
    end if;
    agent_ids := array_append(agent_ids, uid);

    insert into public.agency_members (agency_id, user_id, role)
      values (demo_agency, uid, (case when i = 1 then 'admin' else 'agent' end)::public.member_role)
      on conflict (agency_id, user_id) do nothing;
  end loop;

  -- 3. Safety net: drop any stray non-demo agency for these agents (no signup
  --    trigger creates these anymore — see header note — but keep this so a
  --    manually-created stray membership doesn't leak the agent into another
  --    agency on reseed) ─────────────────────────────────────────────────────
  delete from public.agencies a
   where a.id <> demo_agency
     and a.id in (select agency_id from public.agency_members where user_id = any(agent_ids));

  -- 4. Reset demo-agency data (join tables cascade via FK) ─────────────────────
  --    Disposals are owned by cdg_listings.sql, so we leave that supply untouched.
  delete from public.contacts  where agency_id = demo_agency;
  delete from public.companies where agency_id = demo_agency;

  -- 5. 50 companies ────────────────────────────────────────────────────────────
  --    Each company is placed in the London district named in its company name,
  --    with a little jitter (~±0.6km) so pins don't stack on one point.
  for i in 1..50 loop
    pidx  := 1 + floor(random() * 20)::int;
    cplace := places[pidx];
    clat  := place_lats[pidx] + (random() - 0.5) * 0.012;
    clng  := place_lngs[pidx] + (random() - 0.5) * 0.012;
    insert into public.companies (agency_id, name, type, sector_tags, website, phone, city, lat, lng, lead_agent_id, created_by)
    values (
      demo_agency,
      trim(cplace || ' ' || concepts[1+floor(random()*15)::int]
           || ' ' || suffixes[1+floor(random()*5)::int]),
      ctypes[1+floor(random()*5)::int],
      array[tags[1+floor(random()*9)::int], tags[1+floor(random()*9)::int]],
      'https://example-' || i || '.co.uk',
      '+44 20 7' || lpad((floor(random()*900000)+100000)::int::text, 6, '0'),
      cplace, clat, clng,
      agent_ids[1+floor(random()*6)::int],
      agent_ids[1+floor(random()*6)::int]
    ) returning id into cid;
    company_ids   := array_append(company_ids, cid);
    company_lats  := array_append(company_lats, clat);
    company_lngs  := array_append(company_lngs, clng);
    company_cities := array_append(company_cities, cplace);
  end loop;

  -- 6. 75 contacts (random company → some companies get several, some none) ────
  --    A contact with a company sits near that company (own jittered pin so
  --    several contacts at one company don't overlap); orphan contacts are
  --    scattered across central London. Either way every contact is mappable.
  for i in 1..75 loop
    if random() < 0.1 then
      j := null;                                   -- orphan contact (no company)
      clat := 51.5074 + (random() - 0.5) * 0.08;
      clng := -0.1278 + (random() - 0.5) * 0.10;
      cplace := 'London';
    else
      j := 1 + floor(random() * 50)::int;          -- attach to a company
      clat := company_lats[j] + (random() - 0.5) * 0.010;
      clng := company_lngs[j] + (random() - 0.5) * 0.010;
      cplace := company_cities[j];
    end if;
    insert into public.contacts (agency_id, company_id, first_name, last_name, email, phone, role, city, lat, lng, lead_agent_id, created_by)
    values (
      demo_agency,
      case when j is null then null else company_ids[j] end,
      firstn[1+floor(random()*20)::int],
      lastn[1+floor(random()*20)::int],
      'contact' || i || '@slc.test',
      '+44 7' || lpad((floor(random()*900000000)+100000000)::bigint::text, 9, '0'),
      croles[1+floor(random()*6)::int],
      cplace, clat, clng,
      agent_ids[1+floor(random()*6)::int],
      agent_ids[1+floor(random()*6)::int]
    );
  end loop;

  -- 7. Additional agents (collaborators) — random subset, never the lead ───────
  --    (Disposal collaborators are assigned by cdg_listings.sql, which owns supply.)
  insert into public.company_agents (agency_id, company_id, user_id)
    select c.agency_id, c.id, m.user_id
      from public.companies c join public.agency_members m on m.agency_id = c.agency_id
     where c.agency_id = demo_agency and m.user_id is distinct from c.lead_agent_id and random() < 0.22
    on conflict do nothing;

  insert into public.contact_agents (agency_id, contact_id, user_id)
    select c.agency_id, c.id, m.user_id
      from public.contacts c join public.agency_members m on m.agency_id = c.agency_id
     where c.agency_id = demo_agency and m.user_id is distinct from c.lead_agent_id and random() < 0.18
    on conflict do nothing;

  raise notice 'Seed complete: agency %, % agents, 50 companies, 75 contacts (disposals via cdg_listings.sql).',
    demo_agency, array_length(agent_ids, 1);
end $$;
