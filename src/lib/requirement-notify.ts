import { createNotifications } from "@/lib/db/queries/messages";

/**
 * Tell agents they have been put on a brief: one in-app notification each, never
 * to the person who made the change. A failed insert is logged and never blocks
 * the save. Shared by the full requirement actions and the panel editor; it
 * lives here, and not in a "use server" file, because it is not a server action.
 */
export async function notifyRequirementAgents(
  agencyId: string,
  requirementId: string,
  title: string,
  recipients: string[],
  actorId: string | null,
  role: "lead agent" | "agent",
): Promise<void> {
  const users = [...new Set(recipients.filter((id) => id && id !== actorId))];
  if (users.length === 0) return;
  try {
    await createNotifications(agencyId, users, {
      title: `You're now ${role === "lead agent" ? "the lead agent" : "an agent"} on “${title}”`,
      body: "Open the requirement to see its criteria and current matches.",
      link: `/requirements/${requirementId}`,
    });
  } catch (err) {
    console.error(`requirement ${requirementId}: agent notification insert failed:`, err);
  }
}
