"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationReadById,
} from "@/lib/actions/messages";
import { cn } from "@/lib/utils";

export type Note = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const NOTIFICATION_POLL_MS = 30_000;

/**
 * In-app notifications bell (#11). Initial notifications are fetched
 * server-side (in the app layout) and passed in; the bell re-reads on open and
 * marks them read in place via the server actions in lib/actions/messages.ts.
 *
 * No live subscription — Supabase's realtime channel (postgres_changes on
 * INSERT) had no Neon/Auth.js equivalent (see db/migrations/0029_tasks.sql's
 * header note). The bell re-fetches when it is opened, every 30 seconds while
 * the tab is visible, and when the tab becomes visible again.
 */
export function NotificationsBell({ initialNotes = [] }: { initialNotes?: Note[] }) {
  const [notes, setNotes] = React.useState<Note[]>(initialNotes);
  const [open, setOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    const rows = await listNotifications();
    setNotes(rows);
  }, []);

  // Poll for new notifications while the tab is visible. A hidden tab stops
  // polling and reads once when it becomes visible again.
  React.useEffect(() => {
    const refresh = () => {
      load().catch(() => {
        // Offline or signed out: keep the notes on screen, try again next tick.
      });
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null) timer = setInterval(refresh, NOTIFICATION_POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const unread = notes.filter((n) => !n.read_at).length;

  async function markAll() {
    if (unread === 0) return;
    await markAllNotificationsRead();
    void load();
  }

  async function markOne(id: string) {
    await markNotificationReadById(id);
    void load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-2 w-[min(320px,calc(100vw-24px))] rounded-md border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium text-foreground">Notifications</span>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAll}
                  className="text-xs text-info hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {notes.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing yet.
                </li>
              ) : (
                notes.map((n) => {
                  const inner = (
                    <div className={cn("px-3 py-2.5", !n.read_at && "bg-muted/40")}>
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {n.body ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                      ) : null}
                    </div>
                  );
                  return (
                    <li key={n.id} className="border-b last:border-0">
                      {n.link ? (
                        <Link
                          href={n.link}
                          onClick={() => {
                            void markOne(n.id);
                            setOpen(false);
                          }}
                          className="block hover:bg-muted/40"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void markOne(n.id)}
                          className="block w-full text-left hover:bg-muted/40"
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
