import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  companyTypeBadge,
  contactRoleBadge,
  listingStatusBadge,
  requirementStatusBadge,
  type BadgeSpec,
} from "@/lib/badges";
import { getContactRoles, roleLabel } from "@/lib/contact-roles";
import { getCompanyTypes, typeLabel } from "@/lib/company-types";
import { escapeLike } from "@/lib/search";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { searchCompanies } from "@/lib/db/queries/companies";
import { listContactsByCompanyIds, searchContacts } from "@/lib/db/queries/contacts";
import { searchDisposals } from "@/lib/db/queries/disposals";
import { searchRequirements } from "@/lib/db/queries/requirements";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const term = ((await searchParams).q ?? "").trim();

  if (!term) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Search" />
        <p className="text-sm text-muted-foreground">
          Search companies, contacts, listings and requirements from the bar above.
        </p>
      </div>
    );
  }

  if (!isDbConfigured) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Search" description={`Results for “${term}”`} />
        <EmptyState icon={Search} title="No results" description="Try a different term." />
      </div>
    );
  }
  const session = await auth();
  const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;

  const pattern = `%${escapeLike(term)}%`;
  const [companies, contactsByField, disposals, requirements] = agencyId
    ? await Promise.all([
        searchCompanies(agencyId, pattern, 10),
        searchContacts(agencyId, pattern, 10),
        searchDisposals(agencyId, pattern, 10),
        searchRequirements(agencyId, pattern, 10),
      ])
    : [[], [], [], []];

  // Also surface contacts found via their firm (company name match), deduped.
  let contactRows = contactsByField;
  const companyIds = companies.map((c) => c.id);
  if (agencyId && companyIds.length) {
    const byFirm = await listContactsByCompanyIds(agencyId, companyIds, 10);
    const seen = new Set(contactRows.map((c) => c.id));
    contactRows = [...contactRows, ...byFirm.filter((c) => !seen.has(c.id))].slice(0, 10);
  }

  const contactRoles = await getContactRoles();
  const companyTypes = await getCompanyTypes();

  const total = companies.length + contactRows.length + disposals.length + requirements.length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Search" description={`Results for “${term}”`} />
      {total === 0 ? (
        <EmptyState icon={Search} title="No results" description="Try a different term." />
      ) : (
        <div className="space-y-6">
          <Group
            title="Companies"
            items={companies.map((c) => ({
              href: `/companies/${c.id}`,
              label: c.name,
              badge: companyTypeBadge(c.type, typeLabel(companyTypes, c.type)),
            }))}
          />
          <Group
            title="Contacts"
            items={contactRows.map((c) => ({
              href: `/contacts/${c.id}`,
              label: [c.first_name, c.last_name].filter(Boolean).join(" "),
              badge: contactRoleBadge(c.role, roleLabel(contactRoles, c.role)),
            }))}
          />
          <Group
            title="Listings"
            items={disposals.map((d) => ({
              href: `/listings/${d.id}`,
              label: `${d.title ?? "Untitled listing"}${d.city ? ` · ${d.city}` : ""}`,
              badge: listingStatusBadge(d.status),
            }))}
          />
          <Group
            title="Requirements"
            items={requirements.map((r) => ({
              href: `/requirements/${r.id}`,
              label: r.title,
              badge: requirementStatusBadge(r.status),
            }))}
          />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  items,
}: {
  title: string;
  items: { href: string; label: string; badge: BadgeSpec }[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y rounded-lg border">
        {items.map((it, i) => (
          <li key={i}>
            <Link
              href={it.href}
              className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/40"
            >
              <span className="font-medium text-foreground">{it.label}</span>
              <Badge tone={it.badge.tone}>{it.badge.label}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
