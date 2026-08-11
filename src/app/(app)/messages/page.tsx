import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Clock, CornerUpLeft, Inbox, Send } from "lucide-react";

import { ComposeMessage } from "@/components/compose-message";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  deleteMessage,
  markMessageRead,
  markNotificationRead,
} from "@/lib/actions/messages";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, getAgencyMembers } from "@/lib/db/queries/agencies";
import { listDealIdsLedBy, listOpenDealReminders } from "@/lib/db/queries/deals";
import { getUserNames } from "@/lib/db/queries/disposals";
import {
  getMessagesByIds,
  listInboxMessages,
  listNotifications,
  listSentMessages,
} from "@/lib/db/queries/messages";
import { isPast } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My Messages" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB");

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (!isDbConfigured) redirect("/login");
  const session = await auth();
  if (!session?.user) redirect("/login");
  const me = session.user.id;
  const agencyId = await currentAgencyId(me);
  if (!agencyId) redirect("/login");

  const { view } = await searchParams;
  const showSent = view === "sent";

  const [msgs, sentMsgs, notes, reminders] = await Promise.all([
    listInboxMessages(agencyId, me, 50),
    showSent ? listSentMessages(agencyId, me, 50) : Promise.resolve([]),
    listNotifications(agencyId, me, 30),
    listOpenDealReminders(agencyId, 100),
  ]);

  const messages = msgs;
  const sent = sentMsgs;
  const notifications = notes;

  // "My" reminders only: ones I set, or on deals where I'm the lead agent.
  const leadDealIds = new Set(await listDealIdsLedBy(agencyId, me));
  const dueReminders = reminders
    .filter((r) => r.created_by === me || leadDealIds.has(r.deal_id))
    .slice(0, 30);

  // Threading: subjects/snippets of the messages being replied to.
  const parentIds = [
    ...new Set(
      [...messages, ...sent].map((m) => m.parent_id).filter((v): v is string => !!v),
    ),
  ];
  const parentOf = new Map<string, string>();
  if (parentIds.length) {
    const parents = await getMessagesByIds(agencyId, parentIds);
    parents.forEach((p) =>
      parentOf.set(p.id, p.subject ?? `${p.body.slice(0, 60)}${p.body.length > 60 ? "…" : ""}`),
    );
  }

  // Display names for inbox senders + sent recipients.
  const personIds = [
    ...new Set([
      ...messages.map((m) => m.sender_id),
      ...sent.map((m) => m.recipient_id),
    ]),
  ];
  const nameOf = personIds.length ? await getUserNames(personIds) : new Map<string, string>();

  const unreadInbox = messages.filter((m) => !m.read_at).length;

  const teammates = await getAgencyMembers(agencyId);

  const tabClass = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Messages</h1>
          <p className="text-sm text-muted-foreground">
            Team messages, notifications and reminders in one place.
          </p>
        </div>
        <ComposeMessage agents={teammates} meId={me} />
      </div>

      {/* ── Inbox / Sent ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            {showSent ? (
              <Send className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Inbox className="h-4 w-4 text-muted-foreground" />
            )}
            {showSent ? "Sent" : "Inbox"}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!showSent && unreadInbox > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {unreadInbox} unread
              </span>
            ) : null}
            <nav className="flex items-center gap-1 rounded-md border p-0.5">
              <Link href="/messages" className={tabClass(!showSent)}>
                Inbox
              </Link>
              <Link href="/messages?view=sent" className={tabClass(showSent)}>
                Sent
              </Link>
            </nav>
          </div>
        </CardHeader>
        <CardContent>
          {showSent ? (
            sent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing sent yet. Hit “New message” above, or use “Send to team” on
                any record to message a colleague.
              </p>
            ) : (
              <ul className="divide-y">
                {sent.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm">
                        <span className="text-muted-foreground">To </span>
                        <span className="font-medium text-foreground">
                          {nameOf.get(m.recipient_id) ?? "Teammate"}
                        </span>
                        {m.subject ? (
                          <span className="text-muted-foreground"> · {m.subject}</span>
                        ) : null}
                      </p>
                      {m.parent_id && parentOf.has(m.parent_id) ? (
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CornerUpLeft className="h-3 w-3 shrink-0" />
                          In reply to “{parentOf.get(m.parent_id)}”
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {m.body}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmt(m.created_at)}
                        {m.read_at ? " · read" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.link ? (
                        <Link
                          href={m.link}
                          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                        >
                          Open
                        </Link>
                      ) : null}
                      <form action={deleteMessage}>
                        <input type="hidden" name="id" value={m.id} />
                        <ConfirmSubmitButton
                          variant="ghost"
                          size="sm"
                          confirmMessage="Delete this message? It disappears for both you and the recipient."
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Hit “New message” above, or use “Send to team” on any
              record to message a colleague.
            </p>
          ) : (
            <ul className="divide-y">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "flex items-start justify-between gap-3 py-3",
                    !m.read_at && "-mx-2 rounded-md bg-primary/5 px-2",
                  )}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm">
                      <span className="font-medium text-foreground">
                        {nameOf.get(m.sender_id) ?? "Teammate"}
                      </span>
                      {m.subject ? (
                        <span className="text-muted-foreground"> · {m.subject}</span>
                      ) : null}
                    </p>
                    {m.parent_id && parentOf.has(m.parent_id) ? (
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CornerUpLeft className="h-3 w-3 shrink-0" />
                        In reply to “{parentOf.get(m.parent_id)}”
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {m.body}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{fmt(m.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.link ? (
                      <Link
                        href={m.link}
                        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                      >
                        Open
                      </Link>
                    ) : null}
                    <ComposeMessage
                      agents={teammates}
                      meId={me}
                      replyTo={{
                        messageId: m.id,
                        senderId: m.sender_id,
                        subject: m.subject,
                      }}
                    />
                    {!m.read_at ? (
                      <form action={markMessageRead}>
                        <input type="hidden" name="id" value={m.id} />
                        <button
                          type="submit"
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Mark read
                        </button>
                      </form>
                    ) : null}
                    <form action={deleteMessage}>
                      <input type="hidden" name="id" value={m.id} />
                      <ConfirmSubmitButton
                        variant="ghost"
                        size="sm"
                        confirmMessage="Delete this message? It disappears for both you and the other person."
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Delete
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Notifications ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications.</p>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-start justify-between gap-3 py-3",
                    !n.read_at && "-mx-2 rounded-md bg-primary/5 px-2",
                  )}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {n.body ? (
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">{fmt(n.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {n.link ? (
                      <Link
                        href={n.link}
                        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                      >
                        Open
                      </Link>
                    ) : null}
                    {!n.read_at ? (
                      <form action={markNotificationRead}>
                        <input type="hidden" name="id" value={n.id} />
                        <button
                          type="submit"
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Mark read
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Reminders (mine: set by me, or on deals I lead) ───── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            My reminders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dueReminders.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No open reminders"
              description="Reminders you set, or on deals you lead, appear here until they're marked done."
            />
          ) : (
            <ul className="divide-y">
              {dueReminders.map((r) => {
                const overdue = isPast(r.due_at);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {r.title}
                      </p>
                      <p
                        className={cn(
                          "text-[11px]",
                          overdue
                            ? "font-medium text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        Due {fmt(r.due_at)}
                        {overdue ? " · overdue" : ""}
                      </p>
                    </div>
                    <Link
                      href={`/deals/${r.deal_id}`}
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                    >
                      Open deal
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
