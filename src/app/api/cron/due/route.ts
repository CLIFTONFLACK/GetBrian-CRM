import { NextResponse } from "next/server";
import { Resend } from "resend";

import { isDbConfigured } from "@/lib/db/client";
import { getUsersByIds } from "@/lib/db/queries/agencies";
import { getDealsByIdsAcrossAgencies, listDueDealReminders, markDealReminderNotified } from "@/lib/db/queries/deals";
import { createNotifications } from "@/lib/db/queries/messages";
import { listDueTasks, markTaskNotified } from "@/lib/db/queries/tasks";

/**
 * GET /api/cron/due — fires notifications (and optional emails) for deal
 * reminders and tasks whose due date has passed. Invoked by Vercel Cron every
 * 15 minutes (see vercel.json); Vercel sends `Authorization: Bearer CRON_SECRET`
 * automatically when the env var is set. Each row fires exactly once — the
 * `notified_at` stamp is only written after its notification insert succeeds,
 * so transient failures retry on the next run.
 *
 * System-wide job, no user session (see AGENTS.md): the CRON_SECRET bearer
 * check below is the entire authorization boundary, unchanged from the
 * Supabase-era version. It reads due reminders/tasks across every agency
 * (listDueDealReminders/listDueTasks are deliberately unscoped by agencyId),
 * but every downstream read/write for a given row is scoped to THAT row's
 * own agency_id — never the caller's, since there is no caller agency here.
 */

const ENTITY_PATHS: Record<string, string> = {
  deal: "/deals",
  listing: "/listings",
  requirement: "/requirements",
  company: "/companies",
  contact: "/contacts",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB");

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured) {
    return NextResponse.json({ error: "STORAGE_CRM_DATABASE_URL not configured." }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  // recipient → plain-text lines, flushed as one email per person at the end.
  const emailLines = new Map<string, string[]>();
  let firedReminders = 0;
  let firedTasks = 0;

  // ── Deal reminders ─────────────────────────────────────────────────────────
  const reminderRows = await listDueDealReminders(100);
  const dealIds = [...new Set(reminderRows.map((r) => r.deal_id))];
  // Cross-agency read (this job has no single caller agency) — each row
  // carries its own agency_id, checked against the reminder's agency_id
  // below before use, so a mismatch (which should never happen given
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
      await markDealReminderNotified(r.agency_id, r.id, nowIso);
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
    await markDealReminderNotified(r.agency_id, r.id, nowIso);
    firedReminders += 1;
    const lines = emailLines.get(recipient) ?? [];
    lines.push(
      `• Reminder due: ${r.title}${deal ? ` (deal “${deal.title}”)` : ""} — was due ${fmt(r.due_at)}`,
    );
    emailLines.set(recipient, lines);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const dueTasks = await listDueTasks(100);

  for (const t of dueTasks) {
    const recipient = t.assignee_id ?? t.created_by ?? null;
    if (!recipient) {
      await markTaskNotified(t.agency_id, t.id, nowIso);
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
    await markTaskNotified(t.agency_id, t.id, nowIso);
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

  return NextResponse.json({
    reminders: firedReminders,
    tasks: firedTasks,
    emailed,
  });
}
