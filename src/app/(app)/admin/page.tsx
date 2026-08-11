import type { Metadata } from "next";

import { AdminPanel, type Member } from "@/components/admin-panel";
import { DataImport } from "@/components/data-import";
import { MarketIntelAdmin, type IntelSourceStatus } from "@/components/market-intel-admin";
import { getContactRoles } from "@/lib/contact-roles";
import { getCompanyTypes } from "@/lib/company-types";
import { INTEL_SOURCES } from "@/lib/intel/sources";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { auth } from "@/lib/auth";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  getAgencySettings,
  listAgencyMembersFull,
  listIntelSourceRows,
} from "@/lib/db/queries/admin";

export const metadata: Metadata = { title: "Admin" };

// The Market Intel resync action scrapes a partner site live (20+ page
// fetches) — give it more than the default function budget.
export const maxDuration = 120;

export default async function AdminPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const agencyId = userId ? await currentAgencyId(userId) : null;
  const admin = agencyId && userId ? await isAgencyAdmin(userId, agencyId) : false;

  if (!userId || !agencyId || !admin) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Admin" description="Team & access management." />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You need to be an agency admin to manage the team.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [memberRows, settings, contactRoles, companyTypes, intelRows] = await Promise.all([
    listAgencyMembersFull(agencyId),
    getAgencySettings(agencyId),
    getContactRoles(),
    getCompanyTypes(),
    listIntelSourceRows(agencyId),
  ]);

  const hasOpenRouterKey = Boolean(settings?.openrouter_api_key);
  const openRouterModel = settings?.openrouter_model ?? "perplexity/sonar";

  // Market Intel per-source stats: row count + newest created_at per source.
  const intelSources: IntelSourceStatus[] = INTEL_SOURCES.map((s) => {
    const rows = intelRows.filter((r) => r.source === s.id);
    const lastSynced = rows.length
      ? rows.map((r) => r.created_at).sort().at(-1)!
      : null;
    return {
      id: s.id,
      label: s.label,
      website: s.website,
      hasScraper: s.scraper !== null,
      count: rows.length,
      lastSynced,
    };
  });

  const members: Member[] = memberRows
    .map((m) => ({
      id: m.id,
      role: m.role,
      email: m.email,
      fullName: m.full_name,
      phone: m.phone,
      avatarUrl: m.avatar_url,
      linkedinUrl: m.linkedin_url,
      xUrl: m.x_url,
    }))
    .sort((a, b) => {
      const an = a.fullName ?? a.email ?? "";
      const bn = b.fullName ?? b.email ?? "";
      return a.role === b.role
        ? an.localeCompare(bn)
        : a.role === "admin"
          ? -1
          : 1;
    });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Admin"
        description="Add agents, manage roles and reset passwords."
      />
      <AdminPanel
        members={members}
        currentUserId={userId}
        hasOpenRouterKey={hasOpenRouterKey}
        openRouterModel={openRouterModel}
        contactRoles={contactRoles}
        companyTypes={companyTypes}
      />

      <div className="mt-4">
        <CollapsibleCard
          title="Market Intel"
          description="Partner-agent stock: resync live or delete per source."
        >
          <MarketIntelAdmin sources={intelSources} />
        </CollapsibleCard>
      </div>

      <div className="mt-4">
        <CollapsibleCard
          title="Import data"
          description="Bulk-import Companies, Contacts, Requirements and Listings from CSV."
        >
          <DataImport />
        </CollapsibleCard>
      </div>
    </div>
  );
}
