import { sql } from "@/lib/db/client";
import { escapeLike, ilikeTerm } from "@/lib/search";

// DAO for public.contacts (+ its contact_agents join table). Every function
// takes the caller's agencyId as a mandatory first parameter and filters on
// it explicitly — see the same note in companies.ts.

export type Contact = {
  id: string;
  agency_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lead_agent_id: string | null;
  marketing_opt_in: boolean;
  is_primary: boolean;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  county: string | null;
};

/** Row shape for the contacts-list aggregate pass: enough for the tiles,
 *  heatmap, facet dropdowns and the map layer. */
export type ContactFacetRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  company_id: string | null;
};

/** Row shape for the paginated table's detail pass. */
export type ContactListRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
};

/** id + display name only, sorted by first name — feeds the "Add contact"
 *  picker on the company form. */
export async function listContactOptions(
  agencyId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = (await sql`
    select id, first_name, last_name
    from public.contacts
    where agency_id = ${agencyId}
    order by first_name asc
  `) as { id: string; first_name: string; last_name: string | null }[];
  return rows.map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" "),
  }));
}

/** Cross-entity search hit list (id, first/last name, role) — matches first
 *  name, last name, email or phone. Feeds /search; `pattern` must already be
 *  escapeLike-sanitized by the caller (see src/lib/search.ts). */
export async function searchContacts(
  agencyId: string,
  pattern: string,
  limit = 10,
): Promise<{ id: string; first_name: string; last_name: string | null; role: string }[]> {
  return (await sql`
    select id, first_name, last_name, role from public.contacts
    where agency_id = ${agencyId}
      and (first_name ilike ${pattern} or last_name ilike ${pattern}
           or email ilike ${pattern} or phone ilike ${pattern})
    limit ${limit}
  `) as { id: string; first_name: string; last_name: string | null; role: string }[];
}

/** Contacts whose firm matches one of `companyIds` — /search also surfaces
 *  contacts found via a company-name hit, deduped by the caller against the
 *  field-match results above. */
export async function listContactsByCompanyIds(
  agencyId: string,
  companyIds: string[],
  limit = 10,
): Promise<{ id: string; first_name: string; last_name: string | null; role: string }[]> {
  if (companyIds.length === 0) return [];
  return (await sql`
    select id, first_name, last_name, role from public.contacts
    where agency_id = ${agencyId} and company_id = ANY(${companyIds}::uuid[])
    limit ${limit}
  `) as { id: string; first_name: string; last_name: string | null; role: string }[];
}

/** Contacts belonging to one company — feeds the company detail page's
 *  "Contacts" card. */
export async function listContactsByCompany(
  agencyId: string,
  companyId: string,
): Promise<
  {
    id: string;
    first_name: string;
    last_name: string | null;
    role: string;
    email: string | null;
    is_primary: boolean;
  }[]
> {
  // Primary first, so callers that just take [0] — the company edit form's
  // pre-selected contact, the send flows' default recipient — get the right one
  // without every one of them having to know the rule.
  return (await sql`
    select id, first_name, last_name, role, email, is_primary
    from public.contacts
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by is_primary desc, first_name asc
  `) as {
    id: string;
    first_name: string;
    last_name: string | null;
    role: string;
    email: string | null;
    is_primary: boolean;
  }[];
}

export async function getContactById(agencyId: string, id: string): Promise<Contact | null> {
  // created_at/updated_at are cast to text — see companies.ts's
  // getCompanyById for why (neon()'s lossy Date round trip on timestamptz).
  const rows = await sql`
    select
      id, agency_id, company_id, first_name, last_name, email, phone, role, notes,
      created_by, created_at::text as created_at, updated_at::text as updated_at,
      lead_agent_id, marketing_opt_in, is_primary, address_line, city, postcode, lat, lng, county
    from public.contacts
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (rows[0] as Contact | undefined) ?? null;
}

/**
 * The contacts-list aggregate pass (search + sort applied, unpaginated) —
 * source for the tiles, town×role heatmap and the map layer. `q` matches
 * first name, last name or email (mirrors the original `.or()` filter).
 */
export async function listContactFacetRows(
  agencyId: string,
  opts: { q?: string; column: "first_name" | "role"; ascending: boolean },
): Promise<ContactFacetRow[]> {
  const term = opts.q ? ilikeTerm(opts.q) : "";
  const pattern = term ? `%${term}%` : null;
  if (opts.column === "role") {
    return (opts.ascending
      ? await sql`
          select id, first_name, last_name, role, address_line, city, postcode, county, lat, lng, company_id
          from public.contacts
          where agency_id = ${agencyId}
            and (${pattern}::text is null
                 or first_name ilike ${pattern} or last_name ilike ${pattern} or email ilike ${pattern})
          order by role asc, first_name asc
        `
      : await sql`
          select id, first_name, last_name, role, address_line, city, postcode, county, lat, lng, company_id
          from public.contacts
          where agency_id = ${agencyId}
            and (${pattern}::text is null
                 or first_name ilike ${pattern} or last_name ilike ${pattern} or email ilike ${pattern})
          order by role desc, first_name asc
        `) as ContactFacetRow[];
  }
  return (opts.ascending
    ? await sql`
        select id, first_name, last_name, role, address_line, city, postcode, county, lat, lng, company_id
        from public.contacts
        where agency_id = ${agencyId}
          and (${pattern}::text is null
               or first_name ilike ${pattern} or last_name ilike ${pattern} or email ilike ${pattern})
        order by first_name asc
      `
    : await sql`
        select id, first_name, last_name, role, address_line, city, postcode, county, lat, lng, company_id
        from public.contacts
        where agency_id = ${agencyId}
          and (${pattern}::text is null
               or first_name ilike ${pattern} or last_name ilike ${pattern} or email ilike ${pattern})
        order by first_name desc
      `) as ContactFacetRow[];
}

/** Detail pass for a specific page of ids (order is re-applied by the caller —
 *  `= ANY()` does not preserve the requested order). */
export async function getContactsByIds(
  agencyId: string,
  ids: string[],
): Promise<ContactListRow[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, first_name, last_name, role, email, phone, company_id
    from public.contacts
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as ContactListRow[];
}

/** Case-insensitive pre-insert duplicate lookup on email. Returns the
 *  existing contact's display name, or null when there is no duplicate (or
 *  no email was submitted). */
export async function findDuplicateContactByEmail(
  agencyId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const rows = await sql`
    select first_name, last_name from public.contacts
    where agency_id = ${agencyId} and email ilike ${escapeLike(email)}
    limit 1
  `;
  const row = rows[0] as { first_name: string; last_name: string | null } | undefined;
  if (!row) return null;
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed contact";
}

export type ContactWriteInput = {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  companyId: string | null;
  county: string | null;
  notes: string | null;
  leadAgentId: string | null;
  marketingOptIn: boolean;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
};

export async function createContact(
  agencyId: string,
  createdBy: string,
  input: ContactWriteInput,
  geo: { lat: number | null; lng: number | null },
): Promise<{ id: string }> {
  const rows = await sql`
    insert into public.contacts (
      agency_id, created_by, first_name, last_name, email, phone, role, company_id,
      notes, lead_agent_id, marketing_opt_in,
      address_line, city, postcode, county, lat, lng
    ) values (
      ${agencyId}, ${createdBy}, ${input.firstName}, ${input.lastName}, ${input.email},
      ${input.phone}, ${input.role}, ${input.companyId},
      ${input.notes}, ${input.leadAgentId}, ${input.marketingOptIn},
      ${input.addressLine}, ${input.city}, ${input.postcode}, ${input.county},
      ${geo.lat}, ${geo.lng}
    )
    returning id, first_name, last_name
  `;
  return rows[0] as { id: string };
}

/** Same insert as {@link createContact} but also returns first/last name, for
 *  the "+ New contact" quick-create modal which needs a display name back. */
export async function createContactReturningName(
  agencyId: string,
  createdBy: string,
  input: ContactWriteInput,
  geo: { lat: number | null; lng: number | null },
): Promise<{ id: string; first_name: string; last_name: string | null }> {
  const rows = await sql`
    insert into public.contacts (
      agency_id, created_by, first_name, last_name, email, phone, role, company_id,
      notes, lead_agent_id, marketing_opt_in,
      address_line, city, postcode, county, lat, lng
    ) values (
      ${agencyId}, ${createdBy}, ${input.firstName}, ${input.lastName}, ${input.email},
      ${input.phone}, ${input.role}, ${input.companyId},
      ${input.notes}, ${input.leadAgentId}, ${input.marketingOptIn},
      ${input.addressLine}, ${input.city}, ${input.postcode}, ${input.county},
      ${geo.lat}, ${geo.lng}
    )
    returning id, first_name, last_name
  `;
  return rows[0] as { id: string; first_name: string; last_name: string | null };
}

/** The subset of columns geocodeForSave needs to decide whether to
 *  re-geocode, plus updated_at for the optimistic-concurrency check. */
export async function getContactForUpdate(
  agencyId: string,
  id: string,
): Promise<{
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
} | null> {
  // updated_at::text — see companies.ts's getCompanyForUpdate for why this
  // cast matters (a lossy Date round trip would spuriously reject saves that
  // never actually conflicted).
  const rows = await sql`
    select address_line, city, postcode, lat, lng, updated_at::text as updated_at
    from public.contacts
    where id = ${id} and agency_id = ${agencyId}
    limit 1
  `;
  return (
    (rows[0] as {
      address_line: string | null;
      city: string | null;
      postcode: string | null;
      lat: number | null;
      lng: number | null;
      updated_at: string;
    } | undefined) ?? null
  );
}

/** See companies.ts's `updateCompany` for the `geo: null` = "leave
 *  untouched" convention and the optimistic-concurrency semantics.
 *
 *  Moving a contact to another company clears `is_primary` in the same UPDATE
 *  (the right-hand `company_id` reads the OLD value), otherwise a primary
 *  re-parented onto a company that already has one trips
 *  `contacts_one_primary_per_company`. `setContactPrimary` runs afterwards and
 *  re-promotes if the form still has the box ticked. */
export async function updateContact(
  agencyId: string,
  id: string,
  expectedUpdatedAt: string,
  input: ContactWriteInput,
  geo: { lat: number | null; lng: number | null } | null,
): Promise<{ id: string } | null> {
  const rows = geo
    ? await sql`
        update public.contacts set
          first_name = ${input.firstName},
          last_name = ${input.lastName},
          email = ${input.email},
          phone = ${input.phone},
          role = ${input.role},
          company_id = ${input.companyId},
          is_primary = case when company_id is distinct from ${input.companyId} then false else is_primary end,
          notes = ${input.notes},
          lead_agent_id = ${input.leadAgentId},
          marketing_opt_in = ${input.marketingOptIn},
          address_line = ${input.addressLine},
          city = ${input.city},
          postcode = ${input.postcode},
          county = ${input.county},
          lat = ${geo.lat},
          lng = ${geo.lng}
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `
    : await sql`
        update public.contacts set
          first_name = ${input.firstName},
          last_name = ${input.lastName},
          email = ${input.email},
          phone = ${input.phone},
          role = ${input.role},
          company_id = ${input.companyId},
          is_primary = case when company_id is distinct from ${input.companyId} then false else is_primary end,
          notes = ${input.notes},
          lead_agent_id = ${input.leadAgentId},
          marketing_opt_in = ${input.marketingOptIn},
          address_line = ${input.addressLine},
          city = ${input.city},
          postcode = ${input.postcode},
          county = ${input.county}
        where id = ${id} and agency_id = ${agencyId} and updated_at = ${expectedUpdatedAt}
        returning id
      `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

export async function deleteContact(agencyId: string, id: string): Promise<void> {
  await sql`delete from public.contacts where id = ${id} and agency_id = ${agencyId}`;
}

/** Used by createCompany's "#13: optionally attach a contact chosen (or
 *  quick-created) on the form" flow. No-op if the contact isn't in this
 *  agency. Returns true if a row was updated. */
export async function linkContactToCompany(
  agencyId: string,
  contactId: string,
  companyId: string,
): Promise<boolean> {
  // Same primary-flag guard as updateContact: a primary that changes company
  // stops being primary, or the one-primary-per-company index rejects the move.
  const rows = await sql`
    update public.contacts set
      company_id = ${companyId},
      is_primary = case when company_id = ${companyId} then is_primary else false end
    where id = ${contactId} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
}

/**
 * Set or clear a contact's "primary contact for their company" flag
 * (db/migrations/0038).
 *
 * Promoting one demotes whoever held it, in a single transaction — the partial
 * unique index `contacts_one_primary_per_company` would otherwise reject the
 * second UPDATE, and doing it in two round trips would leave a window with two
 * primaries (or, if the second failed, none).
 *
 * A contact with no company can't be primary — there is nothing to be primary
 * of — so that case just clears the flag.
 */
export async function setContactPrimary(
  agencyId: string,
  contactId: string,
  companyId: string | null,
  isPrimary: boolean,
): Promise<void> {
  if (!isPrimary || !companyId) {
    await sql`
      update public.contacts set is_primary = false
      where id = ${contactId} and agency_id = ${agencyId}
    `;
    return;
  }
  await sql.transaction((tx) => [
    tx`
      update public.contacts set is_primary = false
      where agency_id = ${agencyId} and company_id = ${companyId} and id <> ${contactId}
        and is_primary
    `,
    tx`
      update public.contacts set is_primary = true
      where id = ${contactId} and agency_id = ${agencyId} and company_id = ${companyId}
    `,
  ]);
}

/** The company's primary contact, or null when none has been nominated. */
export async function getPrimaryContactForCompany(
  agencyId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await sql`
    select id from public.contacts
    where agency_id = ${agencyId} and company_id = ${companyId} and is_primary
    limit 1
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

/**
 * Who the Send Deal wizard should pre-tick for each requirement: the
 * requirement's own contact when it has one (and it is still in this agency),
 * else the primary contact of the requirement's company. Requirements that
 * resolve to nobody are absent from the map.
 */
export async function getDefaultSendContactsForRequirements(
  agencyId: string,
  requirementIds: string[],
): Promise<Map<string, string>> {
  if (requirementIds.length === 0) return new Map();
  const rows = (await sql`
    select r.id, coalesce(c.id, p.id) as contact_id
    from public.requirements r
    left join public.contacts c on c.id = r.contact_id and c.agency_id = r.agency_id
    left join public.contacts p
      on p.company_id = r.company_id and p.agency_id = r.agency_id and p.is_primary
    where r.agency_id = ${agencyId} and r.id = ANY(${requirementIds}::uuid[])
  `) as { id: string; contact_id: string | null }[];
  return new Map(
    rows.filter((r) => r.contact_id).map((r) => [r.id, r.contact_id as string]),
  );
}

/** Additional-agent (collaborator) user ids for a contact. */
export async function getContactAgentIds(agencyId: string, contactId: string): Promise<string[]> {
  const rows = await sql`
    select user_id from public.contact_agents
    where agency_id = ${agencyId} and contact_id = ${contactId}
  `;
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}

/** Replaces a contact's additional-agent rows — see companies.ts's
 *  `syncCompanyAgents` for the delete+unnest-insert pattern. */
export async function syncContactAgents(
  agencyId: string,
  contactId: string,
  userIds: string[],
): Promise<void> {
  await sql.transaction((tx) => [
    tx`delete from public.contact_agents where agency_id = ${agencyId} and contact_id = ${contactId}`,
    tx`
      insert into public.contact_agents (agency_id, contact_id, user_id)
      select ${agencyId}, ${contactId}, u from unnest(${userIds}::uuid[]) as u
    `,
  ]);
}
