import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Inbox, Mail, Phone } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { FilterTiles } from "@/components/filter-tiles";
import { PageHeader } from "@/components/page-header";
import { PublicFormLink } from "@/components/public-form-link";
import { Card, CardContent } from "@/components/ui/card";
import { ReviewActions } from "./review-actions";
import { filterHref } from "@/lib/sort";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listIntakeSubmissions } from "@/lib/db/queries/intake";

export const metadata: Metadata = { title: "Intake" };

// Not imported from the client component: every export of a "use client"
// module reaches the server as a client *reference*, not its value, so a
// constant read here would stringify as a stub function.
const PUBLIC_FORM_PATH = "/submit-requirement";

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const money = (n: number | null) =>
  n == null ? null : `£${n.toLocaleString("en-GB")}`;

/** "1,000–3,500 sq ft" / "from 1,000 sq ft" / null when neither bound is set. */
function range(min: number | null, max: number | null, unit: string) {
  const lo = min?.toLocaleString("en-GB");
  const hi = max?.toLocaleString("en-GB");
  if (lo && hi) return `${lo}–${hi} ${unit}`;
  if (lo) return `from ${lo} ${unit}`;
  if (hi) return `up to ${hi} ${unit}`;
  return null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

type SubmissionRow = {
  id: string;
  status: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  property_type: string | null;
  target_locations: string | null;
  min_sqft: number | null;
  max_sqft: number | null;
  min_covers: number | null;
  max_covers: number | null;
  max_rent: number | null;
  max_premium: number | null;
  notes: string | null;
  created_requirement_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function SubmissionCard({
  s,
  reviewerName,
}: {
  s: SubmissionRow;
  reviewerName: string | null;
}) {
  const who = [s.first_name, s.last_name].filter(Boolean).join(" ");
  const fields: { label: string; value: string }[] = [];
  if (s.property_type) fields.push({ label: "Property type", value: s.property_type });
  if (s.target_locations)
    fields.push({ label: "Target locations", value: s.target_locations });
  const size = range(s.min_sqft, s.max_sqft, "sq ft");
  if (size) fields.push({ label: "Size", value: size });
  const covers = range(s.min_covers, s.max_covers, "covers");
  if (covers) fields.push({ label: "Covers", value: covers });
  if (s.max_rent != null)
    fields.push({ label: "Max rent", value: `${money(s.max_rent)} pa` });
  if (s.max_premium != null)
    fields.push({ label: "Max premium", value: money(s.max_premium)! });

  return (
    <Card>
      <CardContent className="space-y-4 pt-4 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {s.company_name || "Unnamed company"}
            </p>
            <p className="text-xs text-muted-foreground">
              {who || "Unnamed contact"} · submitted {fmt(s.created_at)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
            {s.email ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                <a href={`mailto:${s.email}`} className="hover:underline">
                  {s.email}
                </a>
              </span>
            ) : null}
            {s.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {s.phone}
              </span>
            ) : null}
          </div>
        </div>

        {fields.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
        ) : null}

        {s.notes ? (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{s.notes}</p>
          </div>
        ) : null}

        {s.status === "pending" ? (
          <ReviewActions id={s.id} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {s.status === "approved" ? "Approved" : "Rejected"}
            {s.reviewed_at ? ` ${fmt(s.reviewed_at)}` : ""}
            {reviewerName ? ` by ${reviewerName}` : ""}
            {s.created_requirement_id ? (
              <>
                {" · "}
                <Link
                  href={`/requirements/${s.created_requirement_id}`}
                  className="text-info underline-offset-4 hover:underline"
                >
                  Open requirement
                </Link>
              </>
            ) : null}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = STATUSES.some((s) => s.value === status)
    ? (status as string)
    : "pending";

  const session = isDbConfigured ? await auth() : null;
  const agencyId = session?.user ? await currentAgencyId(session.user.id) : null;

  // Absolute, shareable URL for the public form — built from the request so it
  // is right on localhost, a preview alias and production alike.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const publicFormUrl = host ? `${proto}://${host}${PUBLIC_FORM_PATH}` : PUBLIC_FORM_PATH;

  const rows: SubmissionRow[] = agencyId ? await listIntakeSubmissions(agencyId) : [];
  const shown = rows.filter((r) => r.status === active);

  // Reviewer display names (only needed on the reviewed tabs).
  const members = agencyId ? await getAgencyMembers(agencyId) : [];
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  const tiles = STATUSES.map((s) => ({
    value: s.value,
    label: s.label,
    count: rows.filter((r) => r.status === s.value).length,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Requirement intake"
        description="Requirements submitted through the public form. Nothing reaches the CRM until it's approved here."
      />

      <PublicFormLink url={publicFormUrl} />

      <FilterTiles
        tiles={tiles}
        activeValue={active}
        hrefFor={(value) => filterHref({ status: active }, { status: value })}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={`No ${active} submissions`}
          description={
            active === "pending"
              ? "New submissions from /submit-requirement land here for review."
              : "Nothing has been filed under this status yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((s) => (
            <SubmissionCard
              key={s.id}
              s={s}
              reviewerName={s.reviewed_by ? (nameOf.get(s.reviewed_by) ?? null) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
