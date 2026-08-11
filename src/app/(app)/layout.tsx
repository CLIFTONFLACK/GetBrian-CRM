import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import type { Note } from "@/components/notifications-bell";
import { auth } from "@/lib/auth";
import { isDbConfigured, sql } from "@/lib/db/client";

// Every page in this group is auth-gated and reads the request's cookies via
// auth(), so none of them can be statically prerendered. Forcing dynamic
// rendering here (route segment config is inherited by all child segments)
// keeps `next build` from evaluating these pages at build time — which
// otherwise throws when DATABASE_URL/AUTH_SECRET are absent (e.g. in CI).
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { email?: string } | null = null;
  let isAdmin = false;
  let notifications: Note[] = [];
  let unreadMessages = 0;

  // Real auth boundary lives here (src/proxy.ts is just a pass-through now —
  // see its module doc). Before Neon is provisioned we render a demo shell
  // instead of locking people out.
  if (isDbConfigured) {
    // auth() verifies the session JWT locally (HS256, AUTH_SECRET) — no
    // database round trip needed just to know who's signed in.
    const session = await auth();
    if (!session?.user) redirect("/login");
    const userId = session.user.id;
    user = { email: session.user.email ?? undefined };

    // Scope to the caller's OWN membership row — an unscoped role='admin'
    // check would leak the Admin nav to any non-admin whose agency has an
    // admin. No RLS on this schema (app-layer tenant isolation per the
    // migration plan), so this scoping is the only thing enforcing that.
    const [adminRows, noteRows, unreadRows] = await Promise.all([
      sql`
        select 1 from public.agency_members
        where user_id = ${userId} and role = 'admin'
        limit 1
      ` as Promise<unknown[]>,
      sql`
        select id, title, body, link, read_at, created_at
        from public.notifications
        where user_id = ${userId}
        order by created_at desc
        limit 20
      ` as unknown as Promise<Note[]>,
      sql`
        select count(*)::int as count
        from public.messages
        where recipient_id = ${userId} and read_at is null
      ` as unknown as Promise<{ count: number }[]>,
    ]);
    isAdmin = adminRows.length > 0;
    notifications = noteRows;
    unreadMessages = unreadRows[0]?.count ?? 0;
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar isAdmin={isAdmin} unreadMessages={unreadMessages} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          demo={!isDbConfigured}
          isAdmin={isAdmin}
          notifications={notifications}
        />
        <main className="flex-1 overflow-x-hidden p-6 text-sm">{children}</main>
      </div>
    </div>
  );
}
