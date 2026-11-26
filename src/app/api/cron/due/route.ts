import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { Resend } from "resend";

import { isDbConfigured } from "@/lib/db/client";
import { getUsersByIds } from "@/lib/db/queries/agencies";
import { createNotifications } from "@/lib/db/queries/messages";
import { claimDueAgencies, releaseClaim } from "@/lib/db/queries/reminder-settings";
import { listDueTodos, markTodoNotified } from "@/lib/db/queries/activities";

/**
 * GET /api/cron/due — fires notifications (and optional emails) for to-dos
 * whose due date has passed. A to-do is an activity with a status
 * (db/migrations/0049); deal reminders and tasks were folded into it. Vercel Cron calls it every
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
 * to-dos are read with that agency's id, and every downstream
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
  todos: number;
  emailed: number;
  error?: string;
};

/** Sends the in-app notifications and the optional email digest for ONE agency. */
async function runAgency(agencyId: string, notBefore: string, nowIso: string): Promise<AgencyResult> {
  // recipient → plain-text lines, flushed as one email per person at the end.
  const emailLines = new Map<string, string[]>();
  let firedTodos = 0;

  // ── To-dos ─────────────────────────────────────────────────────────────────
  const dueTodos = await listDueTodos(100, { agencyId, notBefore });

  for (const t of dueTodos) {
    const title = t.subject ?? (t.body ? t.body.slice(0, 80) : "To-do");
    const recipient = t.assignee_id ?? t.created_by ?? null;
    if (!recipient) {
      await stamp(() => markTodoNotified(t.agency_id, t.id, nowIso));
      continue;
    }
    const link =
      t.entity_type && t.entity_id && ENTITY_PATHS[t.entity_type]
        ? `${ENTITY_PATHS[t.entity_type]}/${t.entity_id}`
        : "/tasks";
    try {
      await createNotifications(t.agency_id, [recipient], {
        title: `To-do due: ${title}`,
        body: t.due_at ? `Due ${fmt(t.due_at)}` : null,
        link,
      });
    } catch {
      continue; // retry next run
    }
    await stamp(() => markTodoNotified(t.agency_id, t.id, nowIso));
    firedTodos += 1;
    const lines = emailLines.get(recipient) ?? [];
    lines.push(`• To-do due: ${title}${t.due_at ? ` — was due ${fmt(t.due_at)}` : ""}`);
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

  return { agencyId, todos: firedTodos, emailed };
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
      todos: 0,
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
        todos: 0,
        emailed: 0,
        error: "Run failed. See the server log.",
      });
    }
  }

  return NextResponse.json({
    agencies: results,
    todos: results.reduce((n, r) => n + r.todos, 0),
    emailed: results.reduce((n, r) => n + r.emailed, 0),
  });
}
