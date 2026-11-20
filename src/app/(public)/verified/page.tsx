import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Verification sent",
  robots: { index: false, follow: false },
};

/**
 * Where Didit sends the person after the hosted identity check (the session's
 * `callback`). It is public, because that person has no CRM account. It shows
 * no result on purpose: Didit adds the session id and a status to the URL, and
 * those query values can be edited by anyone, so the page does not read them.
 * The agent reads the real decision in the CRM.
 */
export default function VerifiedPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
      <CheckCircle2 className="h-12 w-12 text-success" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Thank you
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        You can close this page. The agency receives the result of your
        identity check. Your agent will contact you if they need more
        information.
      </p>
    </main>
  );
}
