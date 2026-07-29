import Link from "next/link";

import { BrandLockup } from "@/components/brand-lockup";

/* Sign-in and sign-up are built from the app's own UI primitives, so unlike the
   landing page they follow the theme rather than pinning the light brand
   ground. The app palette is the Brian ramp either way. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4 py-12">
      <Link
        href="/"
        aria-label="Brian CRM — home"
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <BrandLockup size="lg" tone="app" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <a
        href="https://getbrian.xyz"
        target="_blank"
        rel="noopener"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Built by Brian
      </a>
    </div>
  );
}
