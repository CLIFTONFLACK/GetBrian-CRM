import { NextResponse, type NextRequest } from "next/server";

// Next.js 16: Middleware was renamed to Proxy. This file must live at the
// same level as src/app. Only one proxy file is supported per project.
//
// Under Supabase this file was load-bearing: Supabase's short-lived access
// tokens need refreshing against the Auth server on (almost) every request,
// and the proxy was the only place that could rewrite response cookies
// before a Server Component ever saw them (src/lib/supabase/proxy.ts, still
// present but no longer wired in here). Auth.js's JWT session has no such
// refresh step — the cookie is self-contained and verified locally wherever
// auth() is called, so there's nothing left for a proxy to do on the hot
// path. The real auth boundary remains src/app/(app)/layout.tsx, exactly as
// the old comment here already said it should be.
//
// Kept as a pass-through rather than deleted: a natural, single place to add
// fast, cookie-presence-only optimistic redirects later (e.g. bouncing
// clearly signed-out requests away from (app) routes before they reach a
// Server Component) without introducing a second proxy file.
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets and image files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
