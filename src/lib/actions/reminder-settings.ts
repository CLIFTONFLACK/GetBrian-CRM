"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId, isAgencyAdmin } from "@/lib/db/queries/agencies";
import { saveReminderSettings } from "@/lib/db/queries/reminder-settings";
import type { FormState } from "@/lib/actions/types";
import { parseInterval } from "@/lib/reminder-settings";

/**
 * Saves the agency's reminder switch and interval (Admin page, Reminders card).
 * The admin check runs here on the server, before any write: there is no RLS
 * backstop (see AGENTS.md). The form field "enabled" is a checkbox, so it is
 * present only when ticked.
 */
export async function saveReminderSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const userId = session.user.id;

  const agencyId = await currentAgencyId(userId);
  if (!agencyId) return { error: "No agency is linked to your account." };
  if (!(await isAgencyAdmin(userId, agencyId))) {
    return { error: "Only an agency admin can do that." };
  }

  const intervalMinutes = parseInterval(formData.get("interval_minutes"));
  if (intervalMinutes === null) return { error: "Choose how often reminders are sent." };
  const enabled = formData.get("enabled") === "on";

  try {
    await saveReminderSettings(agencyId, userId, { enabled, intervalMinutes });
  } catch (error) {
    console.error("saveReminderSettingsAction failed", error);
    return { error: "Could not save the reminder settings. Try again." };
  }

  revalidatePath("/admin");
  return { message: enabled ? "Reminders are on." : "Reminders are off." };
}
