-- 0041: enforce the import match keys in the database.
--
-- Numbered last on purpose. scripts/run-migrations.mjs applies every file in
-- filename order in one pass, so a migration that stops the run takes the ones
-- after it down with it. This is the only migration here that CAN legitimately
-- fail on live data (see "IF THIS MIGRATION FAILS" below), so everything else
-- lands first and a halt here costs nothing but this step.
--
-- The importer de-duplicates in application code: it reads a lookup map once,
-- then inserts or updates row by row. That is correct for a single upload and
-- useless against a concurrent one — two imports (or an import racing someone
-- using the form) both read the same stale map and both insert. Until now
-- nothing stopped them: across every migration there were five UNIQUE clauses
-- in the whole schema, and none was on companies, contacts or requirements.
--
-- These indexes are the real guarantee. They are partial (WHERE the key is
-- actually present) because the keys are optional: a company without a
-- Companies House number, or a contact without an email, must still be
-- insertable, and NULLs must not collide with each other.
--
-- Keys, matching src/lib/actions/import-data.ts:
--   company  — Companies House number when present, else name
--   contact  — email when present (the name fallback is intentionally NOT
--              enforced here; see the note at the bottom)
--   requirement — external_ref when present
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IF THIS MIGRATION FAILS
-- ─────────────────────────────────────────────────────────────────────────────
-- A unique index cannot be built over a table that already holds duplicates,
-- and this schema has never prevented them, so live data may well contain some.
-- The failure is deliberate: silently merging or deleting a customer's records
-- to force an index through would be far worse than a migration that stops and
-- says what is wrong.
--
-- The DO block below runs first and raises with the offending values named, so
-- the error tells you exactly what to fix rather than just "duplicate key".
-- Resolve the duplicates (merge or rename in the UI), then re-run.
--
-- To see them without running the migration:
--
--   select agency_id, lower(name), count(*)
--     from public.companies group by 1,2 having count(*) > 1;
--   select agency_id, lower(company_number), count(*)
--     from public.companies
--    where company_number is not null and company_number <> ''
--    group by 1,2 having count(*) > 1;
--   select agency_id, lower(email), count(*)
--     from public.contacts
--    where email is not null and email <> ''
--    group by 1,2 having count(*) > 1;

do $$
declare
  dupes text;
begin
  select string_agg(msg, E'\n') into dupes from (
    select 'company name: ' || quote_literal(lower(name)) ||
           ' (agency ' || agency_id || ', ' || count(*) || ' rows)' as msg
      from public.companies
     group by agency_id, lower(name)
    having count(*) > 1
    union all
    select 'company number: ' || quote_literal(lower(company_number)) ||
           ' (agency ' || agency_id || ', ' || count(*) || ' rows)'
      from public.companies
     where company_number is not null and company_number <> ''
     group by agency_id, lower(company_number)
    having count(*) > 1
    union all
    select 'contact email: ' || quote_literal(lower(email)) ||
           ' (agency ' || agency_id || ', ' || count(*) || ' rows)'
      from public.contacts
     where email is not null and email <> ''
     group by agency_id, lower(email)
    having count(*) > 1
    union all
    select 'requirement external_ref: ' || quote_literal(lower(external_ref)) ||
           ' (agency ' || agency_id || ', ' || count(*) || ' rows)'
      from public.requirements
     where external_ref is not null and external_ref <> ''
     group by agency_id, lower(external_ref)
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise exception E'Cannot add the import de-duplication indexes: existing duplicates.\n%\n\nMerge or rename these records, then re-run this migration.', dupes;
  end if;
end $$;

-- Company: Companies House number is the strong key when it is known.
create unique index if not exists companies_agency_company_number_uniq
  on public.companies (agency_id, lower(company_number))
  where company_number is not null and company_number <> '';

-- Company: name is the fallback key. Case-insensitive, agency-scoped.
create unique index if not exists companies_agency_name_uniq
  on public.companies (agency_id, lower(name));

-- Contact: email is the strong key when it is known.
create unique index if not exists contacts_agency_email_uniq
  on public.contacts (agency_id, lower(email))
  where email is not null and email <> '';

-- Requirement: the caller-supplied import reference (see 0036).
create unique index if not exists requirements_agency_external_ref_uniq
  on public.requirements (agency_id, lower(external_ref))
  where external_ref is not null and external_ref <> '';

-- Deliberately NOT enforced in the database: the contact name fallback
-- (agency_id, lower(first_name), lower(last_name), company_id). Two different
-- people at one company genuinely can share a name, and a UI that refuses to
-- save the second one would be wrong. The importer still uses the name as a
-- match key so a spreadsheet without emails updates rather than duplicates —
-- that is a reasonable default for a bulk file, but not a rule to impose on
-- every record the agency will ever create.
