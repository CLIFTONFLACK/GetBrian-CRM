"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Handshake,
  Inbox,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/brand-lockup";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  action?: "signout";
};
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/messages", label: "My Messages", icon: MessageSquare },
      { href: "/tasks", label: "Tasks", icon: ListTodo },
      { href: "/intake", label: "Intake", icon: Inbox },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/listings", label: "Listings", icon: Store },
      { href: "/kyc", label: "KYC", icon: ScrollText },
      { href: "/map", label: "Map", icon: MapIcon },
    ],
  },
  {
    label: "Dealflow",
    items: [
      { href: "/requirements", label: "Requirements", icon: Target },
      { href: "/matches", label: "MatchMaker", icon: Sparkles },
      { href: "/deals", label: "Pipeline", icon: Handshake },
      // Admin + manager only, but the sidebar is only told about `isAdmin` —
      // rendering it unconditionally keeps it reachable for managers, and
      // /reports gates itself (non-elevated users get a friendly notice).
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
      { href: "/login", label: "Log out", icon: LogOut, action: "signout" },
    ],
  },
];

/** Filter a group's items by admin access (empty groups are dropped by the caller). */
export function visibleItems(items: NavItem[], isAdmin: boolean): NavItem[] {
  return items.filter((i) => !i.adminOnly || isAdmin);
}

export function AppSidebar({
  isAdmin = false,
  unreadMessages = 0,
}: {
  isAdmin?: boolean;
  /** Unread inbox count — rendered as a pill on the "My Messages" item. */
  unreadMessages?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center border-b px-4">
        <BrandLockup tone="app" />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map((group) => {
          const items = visibleItems(group.items, isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  if (item.action === "signout") {
                    return (
                      <li key={item.label}>
                        <form action={signOut}>
                          <button
                            type="submit"
                            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
                          >
                            <Icon className="h-[18px] w-[18px] shrink-0" />
                            {item.label}
                          </button>
                        </form>
                      </li>
                    );
                  }
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.href === "/messages" && unreadMessages > 0 ? (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                            {unreadMessages > 99 ? "99+" : unreadMessages}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t p-3 text-[11px] text-muted-foreground">
        UK leisure &amp; licensed property
      </div>
    </aside>
  );
}
