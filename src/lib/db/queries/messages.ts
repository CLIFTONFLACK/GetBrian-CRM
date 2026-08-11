import { sql } from "@/lib/db/client";

// DAO for public.messages (internal user-to-user comms, threaded via
// parent_id — see db/migrations/0031_message_threading.sql) and
// public.notifications (per-recipient in-app bell). The two tables are kept
// in one file because every write to `messages` also fans out a
// `notifications` row for each recipient — see messages.ts's `sendMessage`
// action — so they share this DAO the way deal_agents/deal_stage_events
// share deals.ts. Every function takes the caller's agencyId as a mandatory
// first parameter and filters on it explicitly — see the same note in
// companies.ts. There is no RLS backstop on this schema (see AGENTS.md).

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  subject: string | null;
  body: string;
  link: string | null;
  parent_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** Inbox rows — everything sent TO this user. */
export async function listInboxMessages(
  agencyId: string,
  userId: string,
  limit = 50,
): Promise<Omit<Message, "recipient_id">[]> {
  return (await sql`
    select id, sender_id, subject, body, link, parent_id,
           read_at::text as read_at, created_at::text as created_at
    from public.messages
    where agency_id = ${agencyId} and recipient_id = ${userId}
    order by created_at desc
    limit ${limit}
  `) as Omit<Message, "recipient_id">[];
}

/** Sent rows — everything sent BY this user. */
export async function listSentMessages(
  agencyId: string,
  userId: string,
  limit = 50,
): Promise<Omit<Message, "sender_id">[]> {
  return (await sql`
    select id, recipient_id, subject, body, link, parent_id,
           read_at::text as read_at, created_at::text as created_at
    from public.messages
    where agency_id = ${agencyId} and sender_id = ${userId}
    order by created_at desc
    limit ${limit}
  `) as Omit<Message, "sender_id">[];
}

/** Count of unread messages sent TO this user — feeds the dashboard's
 *  "Unread messages" KPI tile. */
export async function countUnreadMessages(agencyId: string, userId: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as count from public.messages
    where agency_id = ${agencyId} and recipient_id = ${userId} and read_at is null
  `;
  return (rows[0] as { count: number }).count;
}

/** Subject/body of several messages — feeds the "in reply to …" thread snippet. */
export async function getMessagesByIds(
  agencyId: string,
  ids: string[],
): Promise<{ id: string; subject: string | null; body: string }[]> {
  if (ids.length === 0) return [];
  return (await sql`
    select id, subject, body from public.messages
    where agency_id = ${agencyId} and id = ANY(${ids}::uuid[])
  `) as { id: string; subject: string | null; body: string }[];
}

/**
 * Resolves a client-supplied `parent_id` to a message the caller may
 * actually reply to (sender or recipient of it, same agency) — the original
 * Supabase version relied on RLS to scope this lookup implicitly; there is no
 * RLS now, so the scoping is explicit here. Returns null for anything else
 * (unknown id, wrong agency, or a message the caller isn't part of).
 */
export async function getVisibleMessageId(
  agencyId: string,
  id: string,
  userId: string,
): Promise<string | null> {
  const rows = await sql`
    select id from public.messages
    where id = ${id} and agency_id = ${agencyId}
      and (sender_id = ${userId} or recipient_id = ${userId})
    limit 1
  `;
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Bulk-inserts one row per recipient (a single logical "send" fans out). */
export async function createMessages(
  agencyId: string,
  senderId: string,
  recipientIds: string[],
  input: { subject: string | null; body: string; link: string | null; parentId: string | null },
): Promise<void> {
  if (recipientIds.length === 0) return;
  await sql`
    insert into public.messages (agency_id, sender_id, recipient_id, subject, body, link, parent_id)
    select ${agencyId}, ${senderId}, r, ${input.subject}, ${input.body}, ${input.link}, ${input.parentId}
    from unnest(${recipientIds}::uuid[]) as r
  `;
}

/** Marks one received message read. Scoped to the recipient — a tampered id
 *  simply matches nothing rather than relying on a policy alone. */
export async function markMessageRead(
  agencyId: string,
  id: string,
  recipientId: string,
): Promise<boolean> {
  const rows = await sql`
    update public.messages set read_at = now()
    where id = ${id} and agency_id = ${agencyId} and recipient_id = ${recipientId}
    returning id
  `;
  return rows.length > 0;
}

/** Deletes a message from either party's view — either may delete (migration
 *  0020's header note), which removes the row for both. */
export async function deleteMessageForParty(
  agencyId: string,
  id: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql`
    delete from public.messages
    where id = ${id} and agency_id = ${agencyId}
      and (sender_id = ${userId} or recipient_id = ${userId})
    returning id
  `;
  return rows.length > 0;
}

// ── Notifications (per-recipient in-app bell) ───────────────────────────────

export type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export async function listNotifications(
  agencyId: string,
  userId: string,
  limit = 20,
): Promise<Notification[]> {
  return (await sql`
    select id, title, body, link, read_at::text as read_at, created_at::text as created_at
    from public.notifications
    where agency_id = ${agencyId} and user_id = ${userId}
    order by created_at desc
    limit ${limit}
  `) as Notification[];
}

/** Bulk-inserts one notification row per recipient (never to yourself — the
 *  caller filters that out, same convention as requirements.ts's
 *  `notifyRequirementAgents`). No-op on an empty recipient list. */
export async function createNotifications(
  agencyId: string,
  recipientIds: string[],
  input: { title: string; body: string | null; link: string | null },
): Promise<void> {
  if (recipientIds.length === 0) return;
  await sql`
    insert into public.notifications (agency_id, user_id, title, body, link)
    select ${agencyId}, r, ${input.title}, ${input.body}, ${input.link}
    from unnest(${recipientIds}::uuid[]) as r
  `;
}

export type NotificationRowInsert = {
  agencyId: string;
  userId: string;
  title: string;
  body: string | null;
  link: string | null;
};

/**
 * Bulk-inserts a batch of notification rows that each carry their OWN
 * title/body/link — unlike {@link createNotifications} (one message fanned
 * out to many recipients), this is for the case where every recipient's
 * message differs (src/lib/actions/matches.ts's "new suggestions for your
 * requirements" digest, where each agent's body lists only their own new
 * matches). No-op on an empty batch.
 */
export async function createNotificationRows(rows: NotificationRowInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await sql.transaction((tx) =>
    rows.map(
      (r) => tx`
        insert into public.notifications (agency_id, user_id, title, body, link)
        values (${r.agencyId}, ${r.userId}, ${r.title}, ${r.body}, ${r.link})
      `,
    ),
  );
}

export async function markNotificationRead(
  agencyId: string,
  id: string,
  userId: string,
): Promise<boolean> {
  const rows = await sql`
    update public.notifications set read_at = now()
    where id = ${id} and agency_id = ${agencyId} and user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}

/** Marks every currently-unread notification for this user read (the bell's
 *  "Mark all read"). Returns the number of rows updated. */
export async function markAllNotificationsRead(agencyId: string, userId: string): Promise<number> {
  const rows = await sql`
    update public.notifications set read_at = now()
    where agency_id = ${agencyId} and user_id = ${userId} and read_at is null
    returning id
  `;
  return rows.length;
}
