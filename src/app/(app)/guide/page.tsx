import type { Metadata } from "next";

import { GuideJourney } from "@/components/guide-journey";
import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { isAnyAgencyAdmin } from "@/lib/db/queries/agencies";

export const metadata: Metadata = { title: "Quick Guide" };

export default async function GuidePage() {
  // Mirror the layout's admin check so the Admin step only shows to admins.
  let isAdmin = false;
  if (isDbConfigured) {
    const session = await auth();
    if (session?.user) {
      isAdmin = await isAnyAgencyAdmin(session.user.id);
    }
  }

  return <GuideJourney isAdmin={isAdmin} />;
}
