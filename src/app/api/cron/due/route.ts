import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { Resend } from "resend";

import { isDbConfigured } from "@/lib/db/client";
import { getUsersByIds } from "@/lib/db/queries/agencies";
import { getDealsByIdsAcrossAgencies, listDueDealReminders, markDealReminderNotified } from "@/lib/db/queries/deals";
import { createNotifications } from "@/lib/db/queries/messages";
import { claimDueAgencies, releaseClaim } from "@/lib/db/queries/reminder-settings";
import { listDueTasks, markTaskNotified } from "@/lib/db/queries/tasks";

/**
 * GET /api/cron/due — fires notifications (and optional emails) for deal
 * reminders and tasks whose due date has passed. Vercel Cron calls it every
 * minute (see vercel.json); Vercel sends `Authorization: Bearer CRON_SECRET`
 * automatically when the env var is set. A Vercel cron cannot be changed from
 * the app, so this route decides from the database whether each agency is due:
 * public.reminder_settings (db/migrations/0047) holds a switch (default OFF)
 * and an interval per agency, and claimDueAgencies() claims the due agencies
 * and stamps last_run_at in one atomic statement. Most calls therefore find
 * nothing to do and return at once. Each row fires exactly once — the
 * `notified_at` stamp is only written after its notification insert succeeds,
 * so transient failures retry on the next run.
 *
 * System-wide job, no user session (see AGENTS.md): the CRON_SECRET bearer
 * check below is the entire authorization boundary, unchanged from the
 * Supabase-era version. Each claimed agency is processed on its own: its
 * reminders and tasks are read with that agency's id, and every downstream
 * read/write for a given row is scoped to THAT row's own agency_id — never the
 * caller's, since there is no caller agency here.
 *
 * RULE: only items with due_at >= the agency's enabled_since are sent.
 * Turning reminders on therefore never floods people with old overdue items;
 * items that fell due before that moment stay unnotified and are never sent.
 */

const ENTITY_PATHS: Record<string, string> = {
  deal: "/deals",
  listing: "/listings",
  requirement: "/requirements",
  company: "/companies",
  contact: "/contacts",
};

// The cron has no viewer zone, so times are stated in UTC.
const fmt = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`;

type AgencyResult = {
  agencyId: string;
  reminders: number;
  tasks: number;
  emailed: number;
  error?: string;
};

/** Sends the in-app notifications and the optional email digest for ONE agency. */
async function runAgency(agencyId: string, notBefore: string, nowIso: string): Promise<AgencyResult> {
  // recipient → plain-text lines, flushed as one email per person at the end.
  const emailLines = new Map<string, string[]>();
  let firedReminders = 0;
  let firedTasks = 0;

  // ── Deal reminders ─────────────────────────────────────────────────────────
  const reminderRows = await listDueDealReminders(100, { agencyId, notBefore });
  const dealIds = [...new Set(reminderRows.map((r) => r.deal_id))];
  // Each row carries its own agency_id, checked against the reminder's
  // agency_id below before use, so a mismatch (which should never happen given
  // deal_reminders.deal_id's FK) can never leak one agency's deal info onto
  // another's notification.
  const dealRows = dealIds.length ? await getDealsByIdsAcrossAgencies(dealIds) : [];
  const dealOf = new Map(dealRows.map((d) => [d.id, d]));

  for (const r of reminderRows) {
    const dealRow = dealOf.get(r.deal_id);
    const deal = dealRow && dealRow.agency_id === r.agency_id ? dealRow : undefined;
    const recipient =
      deal?.lead_agent_id ?? deal?.created_by ?? r.created_by ?? null;
    if (!recipient) {
      // Nobody to tell — stamp it so it doesn't churn every run.
      await stamp(() => markDealReminderNotified(r.agency_id, r.id, nowIso));
      continue;
    }
    try {
      await createNotifications(r.agency_id, [recipient], {
        title: `Reminder due: ${r.title}`,
        body: deal ? `On “${deal.title}” — due ${fmt(r.due_at)}` : `Due ${fmt(r.due_at)}`,
        link: `/deals/${r.deal_id}`,
      });
    } catch {
      continue; // retry next run
    }
    await stamp(() => markDealReminderNotified(r.agency_id, r.id, nowIso));
    firedReminders += 1;
    const lines = emailLines.get(recipient) ?? [];
    lines.push(
      `• Reminder due: ${r.title}${deal ? ` (deal “${deal.title}”)` : ""} — was due ${fmt(r.due_at)}`,
    );
    emailLines.set(recipient, lines);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const dueTasks = await listDueTasks(100, { agencyId, notBefore });

  for (const t of dueTasks) {
    const recipient = t.assignee_id ?? t.created_by ?? null;
    if (!recipient) {
      await stamp(() => markTaskNotified(t.agency_id, t.id, nowIso));
      continue;
    }
    const link =
      t.entity_type && t.entity_id && ENTITY_PATHS[t.entity_type]
        ? `${ENTITY_PATHS[t.entity_type]}/${t.entity_id}`
        : "/tasks";
    try {
      await createNotifications(t.agency_id, [recipient], {
        title: `Task due: ${t.title}`,
        body: t.due_at ? `Due ${fmt(t.due_at)}` : null,
        link,
      });
    } catch {
      continue; // retry next run
    }
    await stamp(() => markTaskNotified(t.agency_id, t.id, nowIso));
    firedTasks += 1;
    const lines = emailLines.get(recipient) ?? [];
    lines.push(`• Task due: ${t.title}${t.due_at ? ` — was due ${fmt(t.due_at)}` : ""}`);
    emailLines.set(recipient, lines);
  }

  // ── Optional email digest (best-effort, failures non-fatal) ────────────────
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  let emailed = 0;
  if (apiKey && from && emailLines.size > 0) {
    const recipients = await getUsersByIds([...emailLines.keys()]);
    const resend = new Resend(apiKey);
    for (const p of recipients) {
      const lines = emailLines.get(p.id);
      if (!lines || !p.email) continue;
      try {
        const { error } = await resend.emails.send({
          from,
          to: p.email,
          subject: `${lines.length} item${lines.length === 1 ? "" : "s"} due in the CRM`,
          text: [
            p.full_name ? `Hi ${p.full_name.split(" ")[0]},` : "Hi,",
            "",
            "The following items are now due:",
            "",
            ...lines,
            "",
            "Open My Messages in the CRM to review them.",
          ].join("\n"),
        });
        if (!error) emailed += 1;
      } catch {
        // Non-fatal — the in-app notification already landed.
      }
    }
  }

  return { agencyId, reminders: firedReminders, tasks: firedTasks, emailed };
}

/**
 * Stamps notified_at without letting a database error escape and stop the rest
 * of the agency's run. If the stamp fails the item is sent again at the next
 * run (a repeat notification is better than a lost one).
 */
async function stamp(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error("cron/due: could not stamp notified_at", error);
  }
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  // Constant-time compare so the bearer secret can't be recovered by timing.
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ error: "STORAGE_CRM_DATABASE_URL not configured." }, { status: 503 });
  }

  const nowIso = new Date().toISOString();

  // Atomic claim: only agencies that are switched on AND due, stamped in the
  // same statement so overlapping calls cannot both run one agency.
  const claimed = await claimDueAgencies();
  if (claimed.length === 0) {
    return NextResponse.json({
      message: "No agency is due.",
      agencies: [],
      reminders: 0,
      tasks: 0,
      emailed: 0,
    });
  }

  const results: AgencyResult[] = [];
  for (const c of claimed) {
    try {
      // enabled_since is always set when an agency is switched on; if a manual
      // edit left it empty, fall back to "now" so no old item is ever sent.
      results.push(await runAgency(c.agencyId, c.enabledSince ?? nowIso, nowIso));
    } catch (error) {
      // One failing agency must not stop the others. Unstamped items retry at
      // the agency's next interval.
      console.error("cron/due: agency run failed", c.agencyId, error);
      // Give the claim back so the next minute retries, not the next interval.
      try {
        await releaseClaim(c.agencyId);
      } catch (releaseError) {
        console.error("cron/due: could not release the claim", c.agencyId, releaseError);
      }
      results.push({
        agencyId: c.agencyId,
        reminders: 0,
        tasks: 0,
        emailed: 0,
        error: "Run failed. See the server log.",
      });
    }
  }

  return NextResponse.json({
    agencies: results,
    reminders: results.reduce((n, r) => n + r.reminders, 0),
    tasks: results.reduce((n, r) => n + r.tasks, 0),
    emailed: results.reduce((n, r) => n + r.emailed, 0),
  });
}
