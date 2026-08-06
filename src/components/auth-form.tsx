"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthState } from "@/lib/actions/types";

type AuthAction = (
  state: AuthState,
  formData: FormData,
) => Promise<AuthState>;

export function AuthForm({
  mode,
  action,
}: {
  mode: "sign-in" | "sign-up";
  action: AuthAction;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );
  const isSignUp = mode === "sign-up";

  return (
    // h-11 / h-12 override the shadcn defaults of h-9 (36px). This is the one
    // form every account starts at and it is overwhelmingly reached on a
    // phone, where 36px is under the 44px minimum touch target.
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@agency.co.uk"
          className="h-11"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          placeholder="••••••••"
          minLength={8}
          className="h-11"
          required
        />
      </div>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <Button type="submit" className="h-12 w-full" disabled={pending}>
        {pending
          ? isSignUp
            ? "Creating account…"
            : "Signing in…"
          : isSignUp
            ? "Create account"
            : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-info hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{" "}
            <Link href="/sign-up" className="text-info hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
