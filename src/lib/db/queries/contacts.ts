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
  { id: string; first_name: string; last_name: string | null; role: string; email: string | null }[]
> {
  return (await sql`
    select id, first_name, last_name, role, email
    from public.contacts
    where agency_id = ${agencyId} and company_id = ${companyId}
    order by first_name asc
  `) as { id: string; first_name: string; last_name: string | null; role: string; email: string | null }[];
}

export async function getContactById(agencyId: string, id: string): Promise<Contact | null> {
  // created_at/updated_at are cast to text — see companies.ts's
  // getCompanyById for why (neon()'s lossy Date round trip on timestamptz).
  const rows = await sql`
    select
      id, agency_id, company_id, first_name, last_name, email, phone, role, notes,
      created_by, created_at::text as created_at, updated_at::text as updated_at,
      lead_agent_id, marketing_opt_in, address_line, city, postcode, lat, lng, county
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
 *  untouched" convention and the optimistic-concurrency semantics. */
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
  const rows = await sql`
    update public.contacts set company_id = ${companyId}
    where id = ${contactId} and agency_id = ${agencyId}
    returning id
  `;
  return rows.length > 0;
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
