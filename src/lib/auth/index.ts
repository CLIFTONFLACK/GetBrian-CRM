import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { isDbConfigured, sql } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";

// Auth.js v5 (next-auth@beta) — see report for why this was chosen over a
// hand-rolled jose session (Step 0: next-auth@beta's published peer
// dependencies already declare `next: "^14.0.0-0 || ^15.0.0 || ^16.0.0"`,
// and Credentials + JWT sessions is the smallest surface area of the
// library — no OAuth callback plumbing, no adapter).
//
// Session strategy is JWT (not database sessions): mirrors the plan's
// "local-JWT-verification" model and needs no `sessions` table. The cookie
// itself IS the session; `auth()` verifies it locally wherever it's called
// (the real auth boundary is src/app/(app)/layout.tsx, not this file or
// src/proxy.ts).

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

// `declare module "next-auth/jwt"` augmentation doesn't resolve under this
// project's moduleResolution ("bundler") against next-auth@beta.32's exports
// map (TS2664) even though the module itself imports fine — so the JWT type
// is extended locally with an intersection instead of via declaration
// merging.
type TokenWithId = { id?: string } & Record<string, unknown>;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Mirrors the (app) layout's isDbConfigured gate: never even try to
        // reach a database that hasn't been provisioned yet.
        if (!isDbConfigured) return null;

        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const rows = await sql`
          select id, email, password_hash, full_name
          from public.users
          where email = ${email}
          limit 1
        `;
        const row = rows[0] as
          | {
              id: string;
              email: string;
              password_hash: string;
              full_name: string | null;
            }
          | undefined;
        if (!row) return null;

        const valid = await verifyPassword(password, row.password_hash);
        if (!valid) return null;

        return {
          id: row.id,
          email: row.email,
          name: row.full_name ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on the sign-in request; persist the id onto
      // the token so every subsequent request's session carries it.
      const t = token as TokenWithId;
      if (user?.id) t.id = user.id;
      return t;
    },
    async session({ session, token }) {
      const id = (token as TokenWithId).id;
      if (id) session.user.id = id;
      return session;
    },
  },
});
