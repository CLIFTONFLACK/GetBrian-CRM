// Standard Auth.js v5 wiring: the library's internal endpoints (CSRF token
// issuance, /api/auth/session, etc.) are served from this catch-all route
// even though sign-in/sign-up here go through Server Actions
// (src/lib/actions/auth.ts) rather than a redirect to this route.
//
// `@/lib/auth` exports `handlers` (an object), not top-level GET/POST —
// destructure it rather than re-exporting names that don't exist there.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
