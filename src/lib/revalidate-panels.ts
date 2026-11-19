import { revalidatePath } from "next/cache";

import { PANEL_HOST_PATHS } from "@/lib/record-ref";

/**
 * Revalidates every page that can host the records panel. Call it from any
 * server action that changes something a panel shows: the panel can be open on
 * any of these pages, so a path-only revalidate leaves it stale on the others.
 * Plain server module, not a "use server" file, so it can export a function that
 * is not a server action.
 */
export function revalidatePanelHosts(): void {
  for (const p of PANEL_HOST_PATHS) revalidatePath(p);
}
