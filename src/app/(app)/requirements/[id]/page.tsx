import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isListingMatchable,
  requirementStatusBadge,
  tenureBadge,
  propertyUseBadge,
} from "@/lib/badges";
import { deleteRequirement } from "@/lib/actions/requirements";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DEFAULT_LOCATION_FLEX, scoreMatch } from "@/lib/matching/score";
import { LocationFlexSlider } from "@/components/location-flex-slider";
import { MatchOpportunities } from "@/components/match-opportunities";
import { SendHistoryCard } from "@/components/send-history-card";
import { SendToTeam } from "@/components/send-to-team";
import { getSendHistory } from "@/lib/send-history";
import { getCompanyTypes } from "@/lib/company-types";
import { getAgencyMembers } from "@/lib/supabase/agency";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

function band(min: number | null, max: number | null, unit = "") {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `${min.toLocaleString("en-GB")}–${max.toLocaleString("en-GB")}${unit}`;
  if (min != null) return `${min.toLocaleString("en-GB")}${unit}+`;
  return `up to ${max!.toLocaleString("en-GB")}${unit}`;
}
const money = (v: number | null) => (v != null ? `£${v.toLocaleString("en-GB")}` : "—");

/** Per-record tab title (was the generic marketing `<title>` before). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("requirements")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.title ?? "Requirement" };
}

export default async function RequirementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flex?: string; error?: string }>;
}) {
  const { id } = await params;
  const { flex, error: actionError } = await searchParams;
  const flexParsed = Number(flex ?? DEFAULT_LOCATION_FLEX);
  const locationFlex = Math.min(
    100,
    Math.max(0, Number.isFinite(flexParsed) ? flexParsed : DEFAULT_LOCATION_FLEX),
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: r } = await supabase
    .from("requirements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  let companyName: string | null = null;
  if (r.company_id) {
    const { data: c } = await supabase
      .from("companies")
      .select("name")
      .eq("id", r.company_id)
      .maybeSingle();
    companyName = c?.name ?? null;
  }

  let contactName: string | null = null;
  if (r.contact_id) {
    const { data: c } = await supabase
      .from("contacts")
      .select("first_name, last_name")
      .eq("id", r.contact_id)
      .maybeSingle();
    contactName = c
      ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "View contact"
      : null;
  }

  const s = requirementStatusBadge(r.status);

  const { data: agentRows } = await supabase
    .from("requirement_agents")
    .select("user_id")
    .eq("requirement_id", id);
  const members = await getAgencyMembers(supabase, r.agency_id);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const leadAgentName = r.lead_agent_id
    ? (nameOf.get(r.lead_agent_id) ?? "Unknown agent")
    : null;
  const additionalAgents = (agentRows ?? []).map((row) => ({
    id: row.user_id,
    name: nameOf.get(row.user_id) ?? "Unknown agent",
  }));

  // Only the columns the scorer + the match rows below actually read — a
  // `select("*")` here dragged every scraped description and image blob across
  // the wire for every listing in the agency.
  const { data: disposals } = await supabase
    .from("disposals")
    .select(
      "id, title, status, listing_type, city, area, postcode, address_line, county, lat, lng, size_sqft, covers_internal, use_class, property_type, disposal_type, rent_pa, premium, guide_price",
    );
  const matches = (disposals ?? [])
    .filter((d) => isListingMatchable(d.status))
    .map((d) => ({ d, ...scoreMatch(r, d, { locationFlex }) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Pickers for the Send Deal wizard's external step.
  const [{ data: companyRows }, { data: contactRows }, companyTypes] = await Promise.all([
    supabase.from("companies").select("id, name").order("name"),
    supabase.from("contacts").select("id, first_name, last_name").order("first_name"),
    getCompanyTypes(),
  ]);
  const companyOptions = companyRows ?? [];
  const contactOptions = (contactRows ?? []).map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed contact",
  }));

  // External send history for this requirement — history card + per-match chips.
  const sendHistory = await getSendHistory(supabase, { requirementId: id });
  const { data: pairSendRows } = await supabase
    .from("external_sends")
    .select("listing_id, contact_id, recipient_email, created_at")
    .eq("requirement_id", id)
    .not("listing_id", "is", null)
    .order("created_at", { ascending: false });
  const contactNameOf = new Map(contactOptions.map((c) => [c.id, c.name]));
  const sentByListing = new Map<string, { name: string; at: string }[]>();
  for (const s of pairSendRows ?? []) {
    const list = sentByListing.get(s.listing_id as string) ?? [];
    list.push({
      name:
        (s.contact_id ? contactNameOf.get(s.contact_id) : null) ?? s.recipient_email,
      at: s.created_at,
    });
    sentByListing.set(s.listing_id as string, list);
  }

  return (
    <div className="mx-auto max-w-4xl">
      {actionError ? (
        <Alert tone="error" className="mb-4">
          Couldn&apos;t delete this requirement: {actionError}
        </Alert>
      ) : null}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          {r.company_id ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Operator:{" "}
              <Link
                href={`/companies/${r.company_id}`}
                className="text-info hover:underline"
              >
                {companyName ?? "View company"}
              </Link>
            </p>
          ) : null}
          {r.contact_id ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Contact:{" "}
              <Link
                href={`/contacts/${r.contact_id}`}
                className="text-info hover:underline"
              >
                {contactName ?? "View contact"}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SendToTeam
            link={`/requirements/${r.id}`}
            subject={r.title}
            agents={members}
            meId={user?.id}
          />
          <Link
            href={`/requirements/${r.id}/edit`}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Pencil />
            Edit
          </Link>
          <form action={deleteRequirement}>
            <input type="hidden" name="id" value={r.id} />
            <ConfirmSubmitButton
              confirmMessage="Delete this requirement? Its matches and agent links will be removed and this can't be undone."
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Zones">
              <ChipList items={r.target_london_zones} tone="indigo" />
            </Row>
            <Row label="Areas">{r.target_neighbourhoods.join(", ") || "—"}</Row>
            <Row label="Towns">{r.target_towns.join(", ") || "—"}</Row>
            <Row label="Counties">{r.target_counties.join(", ") || "—"}</Row>
            <Row label="Regions">{r.target_regions.join(", ") || "—"}</Row>
            {/* Districts are a first-class target (a W1-only brief has nothing
                else), so they must not be invisible on the record. */}
            <Row label="Districts">
              <ChipList items={r.target_postcode_districts} tone="sky" />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Use class">
              <BadgeList items={r.use_classes.map((u) => propertyUseBadge(u))} />
            </Row>
            <Row label="Size">{band(r.min_sqft, r.max_sqft, " sq ft")}</Row>
            <Row label="Covers">{band(r.min_covers, r.max_covers)}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Structure &amp; budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Tenure">
              <BadgeList items={r.tenure_prefs.map((t) => tenureBadge(t))} />
            </Row>
            <Row label="Max rent">
              <span className="font-mono tabular-nums">{money(r.max_rent)}</span>
              {r.max_rent != null ? (
                <span className="text-muted-foreground"> pa</span>
              ) : null}
            </Row>
            <Row label="Max premium">
              <span className="font-mono tabular-nums">{money(r.max_premium)}</span>
            </Row>
            <Row label="Max guide">
              <span className="font-mono tabular-nums">
                {money(r.max_guide_price)}
              </span>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="whitespace-pre-wrap text-foreground">{r.notes ?? "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Lead agent">{leadAgentName ?? "—"}</Row>
            <Row label="Agents">
              {additionalAgents.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {additionalAgents.map((a) => (
                    <Badge key={a.id} tone="slate">
                      {a.name}
                    </Badge>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </Row>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>MatchMaker Opportunities</CardTitle>
          <form className="flex items-end gap-2">
            <LocationFlexSlider defaultValue={locationFlex} />
            <Button type="submit" size="sm" variant="secondary">
              Apply
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <MatchOpportunities
            opportunities={matches.map(({ d, score, reasons }) => ({
              id: d.id,
              title: d.title ?? "Untitled listing",
              city: d.city,
              listingType: d.listing_type,
              score,
              reasons,
              previousSends: sentByListing.get(d.id),
            }))}
            requirementId={r.id}
            requirementTitle={r.title}
            agents={members}
            meId={user?.id}
            companies={companyOptions}
            contacts={contactOptions}
            companyTypes={companyTypes}
          />
        </CardContent>
      </Card>

      <SendHistoryCard sends={sendHistory} className="mt-4" />
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

/** A row of small badges for a plain string array, or an em dash when empty. */
function ChipList({
  items,
  tone,
}: {
  items: readonly string[];
  tone: React.ComponentProps<typeof Badge>["tone"];
}) {
  if (items.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <Badge key={v} tone={tone}>
          {v}
        </Badge>
      ))}
    </span>
  );
}

function BadgeList({
  items,
}: {
  items: { tone: React.ComponentProps<typeof Badge>["tone"]; label: string }[];
}) {
  if (items.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <Badge key={i} tone={it.tone}>
          {it.label}
        </Badge>
      ))}
    </span>
  );
}
