// Shared plumbing for the inline-edit server actions (panel-edit.ts,
// panel-edit-listing.ts, panel-edit-requirement.ts). This is NOT a "use server"
// file: a "use server" module exports only server actions, and every export
// here is a plain helper that a client must never be able to call.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { patchRow, rowExists } from "@/lib/db/queries/patch";
import type { PatchableTable } from "@/lib/db/queries/patch-sql";
import { deriveCounty } from "@/lib/locations";
import { geocodeAddress } from "@/lib/maps/geocode";
import { decideGeo, parseAddress, pinStillValid, type StoredGeo } from "@/lib/panel-fields/address";
import { fieldFor, parseField, type FieldValue, type Registry } from "@/lib/panel-fields/types";
import { revalidatePanelHosts } from "@/lib/revalidate-panels";
import type { FormState } from "@/lib/actions/types";

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export const CHANGED =
  "This record was changed by someone else while you were editing. Close the panel, open it again and retry.";

export type Caller = { userId: string; agencyId: string };

export async function requireCaller(): Promise<Caller | { error: string }> {
  if (!isDbConfigured) return { error: "The database isn't configured yet." };
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };
  const agencyId = await currentAgencyId(session.user.id);
  if (!agencyId) return { error: "No agency is linked to your account." };
  return { userId: session.user.id, agencyId };
}

/** The route of each table's full page, so the page and every panel host refresh after a save. */
const PAGE_OF: Record<PatchableTable, string> = {
  companies: "companies",
  contacts: "contacts",
  disposals: "listings",
  requirements: "requirements",
};

export function refresh(table: PatchableTable, id: string) {
  revalidatePath(`/${PAGE_OF[table]}/${id}`);
  revalidatePanelHosts();
}

export type PatchHooks = {
  /** Adjusts the parsed value before it is written (capitals for postcode districts, for example). */
  transform?: (field: string, value: FieldValue) => FieldValue;
  /** Checks a "select" value that the registry cannot check on its own (a list kept in the database). */
  checkSelect?: (field: string, value: string) => Promise<string | null>;
  /** More columns to write with this one, or an error to refuse the edit. */
  extraValues?: (
    ctx: { agencyId: string; id: string; field: string; value: FieldValue },
  ) => Promise<Record<string, unknown> | { error: string }>;
  /** Runs after a successful write (re-scoring, for example). Failures are logged, never shown as a failed save. */
  after?: (ctx: { agencyId: string; id: string; field: string }) => Promise<void>;
};

/** One field of one record: parse through the registry, then write that column only. */
export async function patchOneField(
  table: PatchableTable,
  registry: Registry,
  fd: FormData,
  hooks: PatchHooks = {},
): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const def = fieldFor(registry, str(fd, "field"));
  if (!def) return { error: "That field cannot be edited here." };

  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  // A list of choices arrives as repeated "value" entries; everything else as one.
  const raw = def.kind === "multi" ? fd.getAll("value") : fd.get("value");
  const parsed = parseField(def, raw);
  if (!parsed.ok) return { error: parsed.error };
  const value = hooks.transform ? hooks.transform(def.key, parsed.value) : parsed.value;

  if (def.kind === "select" && !def.options && typeof value === "string" && hooks.checkSelect) {
    const problem = await hooks.checkSelect(def.key, value);
    if (problem) return { error: problem };
  }

  let extra: Record<string, unknown> = {};
  if (hooks.extraValues) {
    const more = await hooks.extraValues({ agencyId: caller.agencyId, id, field: def.key, value });
    if ("error" in more && typeof more.error === "string") return { error: more.error };
    extra = more;
  }

  const done = await patchRow(table, caller.agencyId, id, { [def.column]: value, ...extra });
  if (!done) {
    return { error: (await rowExists(table, caller.agencyId, id)) ? CHANGED : "This record no longer exists." };
  }

  if (hooks.after) {
    try {
      await hooks.after({ agencyId: caller.agencyId, id, field: def.key });
    } catch (err) {
      console.error(`panel edit: follow-up for ${table} ${id} failed`, err);
    }
  }
  refresh(table, id);
  return { message: "Saved." };
}

/**
 * The address fields together (line, town, postcode, county), with a county fill
 * and a fresh map pin. `getExisting` reads the stored address and pin, so an
 * unchanged address keeps its pin and does not call the geocoder again.
 * Last writer wins on these columns: they are written together with the pin, so
 * text and pin always agree.
 */
export async function patchAddressFor(
  table: PatchableTable,
  fd: FormData,
  getExisting: (agencyId: string, id: string) => Promise<StoredGeo | null>,
  after?: (ctx: { agencyId: string; id: string }) => Promise<void>,
): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Missing record id." };
  const caller = await requireCaller();
  if ("error" in caller) return { error: caller.error };

  const parsed = parseAddress(
    {
      address_line: fd.get("address_line"),
      city: fd.get("city"),
      postcode: fd.get("postcode"),
      county: fd.get("county"),
    },
    deriveCounty,
  );
  if (!parsed.ok) return { error: parsed.error };
  const next = parsed.value;

  const existing = await getExisting(caller.agencyId, id);
  if (!existing) return { error: "This record no longer exists." };

  const geocoded =
    pinStillValid(next, existing) || !(next.address_line || next.city || next.postcode)
      ? null
      : await geocodeAddress(next);
  const geo = decideGeo(next, existing, geocoded);

  const done = await patchRow(table, caller.agencyId, id, { ...next, lat: geo.lat, lng: geo.lng });
  if (!done) return { error: "This record no longer exists." };
  if (after) {
    try {
      await after({ agencyId: caller.agencyId, id });
    } catch (err) {
      console.error(`panel edit: follow-up for ${table} ${id} failed`, err);
    }
  }
  refresh(table, id);
  return { message: geo.note ?? "Saved." };
}

/** Lead agent and additional agents from a form. Every id must be a member of this agency. */
export async function readAgents(
  agencyId: string,
  fd: FormData,
  memberIds: (agencyId: string) => Promise<string[]>,
): Promise<{ lead: string | null; extra: string[] } | { error: string }> {
  const members = new Set(await memberIds(agencyId));
  const lead = str(fd, "lead_agent_id") || null;
  const extra = [...new Set(fd.getAll("additional_agents").map((v) => String(v)).filter(Boolean))].filter(
    (a) => a !== lead,
  );
  if ((lead && !members.has(lead)) || extra.some((a) => !members.has(a))) {
    return { error: "Pick agents from your own team." };
  }
  return { lead, extra };
}
