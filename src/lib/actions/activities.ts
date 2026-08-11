"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { createActivity } from "@/lib/db/queries/activities";
import { Constants, type Database } from "@/lib/database.types";
import type { FormState } from "@/lib/actions/types";

type ActivityType = Database["public"]["Enums"]["activity_type"];
type EntityType = Database["public"]["Enums"]["entity_type"];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const oneOf = <T extends string>(v: string, allowed: readonly T[], fb: T): T =>
  (allowed as readonly string[]).includes(v) ? (v as T) : fb;

const PATH: Record<string, string> = {
  company: "companies",
  contact: "contacts",
  listing: "listings",
  requirement: "requirements",
  deal: "deals",
};

export async function logActivity(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };

  const subject = str(formData, "subject");
  const body = str(formData, "body");
  if (!subject && !body) return { error: "Add a subject or a note." };

  const entityType = str(formData, "entity_type");
  const entityId = str(formData, "entity_id") || null;

  // Optional back-dating: a yyyy-mm-dd from the form maps to that day; blank/
  // invalid falls back to the column default (insert time).
  const occurredOn = str(formData, "occurred_on");
  const occurredAt =
    occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
      ? new Date(`${occurredOn}T12:00:00`).toISOString()
      : null;

  await createActivity(agencyId, session.user.id, {
    type: oneOf<ActivityType>(str(formData, "type"), Constants.public.Enums.activity_type, "note"),
    subject: subject || null,
    body: body || null,
    entityType: entityType
      ? oneOf<EntityType>(entityType, Constants.public.Enums.entity_type, "company")
      : null,
    entityId,
    occurredAt,
  });

  if (entityType && entityId && PATH[entityType]) {
    revalidatePath(`/${PATH[entityType]}/${entityId}`);
  }
  revalidatePath("/dashboard");
  return { message: "Activity logged." };
}
