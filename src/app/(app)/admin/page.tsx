import type { Metadata } from "next";

import {
  IntegrationsSection,
  ListsEditors,
  TeamSection,
  type Member,
} from "@/components/admin-panel";
import { AdminNav } from "@/components/admin/admin-nav";
import { ReminderSettingsCard } from "@/components/admin/reminder-settings-card";
import { TypeAllocationCard } from "@/components/admin/type-allocation-card";
import { DataImport } from "@/components/data-import";
import { MarketIntelAdmin, type IntelSourceStatus } from "@/components/market-intel-admin";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { ADMIN_SECTIONS, parseAdminSection } from "@/lib/admin-sections";
import { auth } from "@/lib/auth";
import { getCompanyTypes } from "@/lib/company-types";
import { getContactRoles } from "@/lib/contact-roles";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import {
  getAgencySettings,
  listAgencyMembersFull,
  listIntelSourceRows,
} from "@/lib/db/queries/admin";
import { getReminderSettings } from "@/lib/db/queries/reminder-settings";
import { INTEL_SOURCES } from "@/lib/intel/sources";

export const metadata: Metadata = { title: "Admin" };

// The Market Intel resync action scrapes a partner site live (20+ page
// fetches) — give it more than the default function budget.
export const maxDuration = 120;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
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

  const section = parseAdminSection((await searchParams).section);
  const meta = ADMIN_SECTIONS.find((s) => s.slug === section)!;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Admin" description="Manage your team, lists, integrations and data." />
      <div className="flex flex-col gap-4 md:flex-row md:gap-8">
        <AdminNav active={section} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">{meta.title}</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">{meta.intro}</p>
          <SectionBody section={section} agencyId={agencyId} userId={userId} />
        </div>
      </div>
    </div>
  );
}

/** Loads and renders only the active section, so a section costs only its own queries. */
async function SectionBody({
  section,
  agencyId,
  userId,
}: {
  section: ReturnType<typeof parseAdminSection>;
  agencyId: string;
  userId: string;
}) {
  switch (section) {
    case "lists": {
      const [contactRoles, companyTypes] = await Promise.all([getContactRoles(), getCompanyTypes()]);
      return (
        <div className="space-y-4">
          <ListsEditors contactRoles={contactRoles} companyTypes={companyTypes} />
          <TypeAllocationCard
            companyTypes={companyTypes.map((t) => ({ slug: t.slug, label: t.label }))}
            contactRoles={contactRoles.map((r) => ({ slug: r.slug, label: r.label }))}
          />
        </div>
      );
    }

    case "integrations": {
      const settings = await getAgencySettings(agencyId);
      return (
        <IntegrationsSection
          hasOpenRouterKey={Boolean(settings?.openrouter_api_key)}
          openRouterModel={settings?.openrouter_model ?? "perplexity/sonar"}
          // Null means "no override" — the editor shows the built-in default instead.
          deepDivePrompt={settings?.deep_dive_prompt ?? null}
          // Only ever whether a key exists — the key itself must not reach the client.
          hasDiditKey={Boolean(settings?.didit_api_key)}
          diditWorkflowId={settings?.didit_workflow_id ?? null}
          hasDiditWebhookSecret={Boolean(settings?.didit_webhook_secret)}
          agencyId={agencyId}
        />
      );
    }

    case "notifications":
      return <ReminderSettingsCard settings={await getReminderSettings(agencyId)} />;

    case "data": {
      // Market Intel per-source stats: row count + newest created_at per source.
      const intelRows = await listIntelSourceRows(agencyId);
      const intelSources: IntelSourceStatus[] = INTEL_SOURCES.map((s) => {
        const rows = intelRows.filter((r) => r.source === s.id);
        const lastSynced = rows.length ? rows.map((r) => r.created_at).sort().at(-1)! : null;
        return {
          id: s.id,
          label: s.label,
          website: s.website,
          hasScraper: s.scraper !== null,
          note: s.note ?? null,
          count: rows.length,
          lastSynced,
        };
      });
      return (
        <div className="space-y-4">
          <CollapsibleCard
            defaultOpen
            title="Import data"
            description="Bulk-import Companies, Contacts, Requirements and Listings from CSV."
          >
            <DataImport />
          </CollapsibleCard>
          <CollapsibleCard
            defaultOpen
            title="Market Intel"
            description="Partner-agent stock: resync live or delete per source."
          >
            <MarketIntelAdmin sources={intelSources} />
          </CollapsibleCard>
        </div>
      );
    }

    default: {
      const memberRows = await listAgencyMembersFull(agencyId);
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
          return a.role === b.role ? an.localeCompare(bn) : a.role === "admin" ? -1 : 1;
        });
      return <TeamSection members={members} currentUserId={userId} />;
    }
  }
}
