import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Centralised Neon Postgres access — the DB-layer equivalent of
// src/lib/supabase/config.ts's isSupabaseConfigured. Kept here so every
// caller can fail soft when the project hasn't been provisioned yet (Neon
// hasn't been created via the Vercel Storage tab as of this phase).
//
// Per the migration plan's Option B (app-layer tenant isolation, no ORM, no
// RLS, no held transactions): `neon()` returns a stateless HTTP query
// function — one request per query, nothing to pool or hold open — so this
// is deliberately not a connection *pool*. Multi-statement atomicity, where
// needed, goes through `sql.transaction()` (a single HTTP round trip that
// runs several independent queries as one non-interactive Postgres
// transaction), not a held client.
// Named STORAGE_CRM_* because that's the Neon storage resource's actual name
// in the Vercel dashboard (Storage tab prefixes injected vars with the
// resource name to avoid collisions) — matched here rather than renamed in
// env vars so .env.local can be a direct copy-paste from Vercel, no drift
// between local and deployed variable names.
const DATABASE_URL = process.env.STORAGE_CRM_DATABASE_URL ?? "";

/** True once DATABASE_URL is present. */
export const isDbConfigured = Boolean(DATABASE_URL);

let cached: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily constructs (and caches) the real neon() client on first use.
 *
 * This can't be done eagerly at module scope: neon() synchronously validates
 * its connection-string argument and throws on anything empty or malformed,
 * so calling it with a placeholder would crash `next build`/every cold start
 * before DATABASE_URL exists — exactly the failure isSupabaseConfigured was
 * built to avoid. Deferring construction until a query actually runs keeps
 * this module import-safe with no env vars set.
 */
function client(): NeonQueryFunction<false, false> {
  if (!isDbConfigured) {
    throw new Error(
      "DATABASE_URL is not set. Check `isDbConfigured` before querying `sql`.",
    );
  }
  return (cached ??= neon(DATABASE_URL));
}

/**
 * Stateless tagged-template SQL query function, e.g. `await sql\`select 1\``.
 * A `Proxy` so calls, `.query()`, `.unsafe()` and `.transaction()` all defer
 * to the lazily-constructed client above — callers get the full
 * NeonQueryFunction surface, not just the tagged-template call, without this
 * module ever touching `DATABASE_URL` until a query is actually issued.
 */
export const sql: NeonQueryFunction<false, false> = new Proxy(
  (() => {
    throw new Error("unreachable: sql proxy target should never be invoked directly");
  }) as unknown as NeonQueryFunction<false, false>,
  {
    apply(_target, _thisArg, args) {
      return Reflect.apply(client(), undefined, args);
    },
    get(_target, prop, receiver) {
      return Reflect.get(client(), prop, receiver);
    },
  },
);
