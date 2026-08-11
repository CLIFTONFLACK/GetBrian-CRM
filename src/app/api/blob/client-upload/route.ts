import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { currentAgencyId } from "@/lib/db/queries/agencies";
import { getDisposalById } from "@/lib/db/queries/disposals";

/**
 * POST /api/blob/client-upload
 *
 * Shared token-minting route for every browser-side Blob upload in the app
 * (agent avatars, listing photos, listing documents) — see AGENTS.md's
 * "Known traps" note: `BLOB_READ_WRITE_TOKEN` must never reach the browser,
 * so a client component can't call `put()` directly. Instead it calls
 * `@vercel/blob/client`'s `upload()`, which first POSTs here to get a
 * short-lived, path-scoped client token, then uploads straight to Blob —
 * bypassing this route (and any serverless function body-size limit)
 * entirely for the actual file bytes.
 *
 * `clientPayload` (set by each caller) identifies which of the three upload
 * kinds this is so the right authorization check runs before a token is
 * minted:
 *   - "avatar": any signed-in user (public bucket, low risk — mirrors the
 *     old Supabase policy, which didn't scope avatar uploads to `isSelf`
 *     either).
 *   - "disposal-image" / "disposal-doc": the disposal must belong to the
 *     caller's agency, same as the write actions that record the resulting
 *     URL (disposal-images.ts / disposal-documents.ts) — this is what
 *     prevents a signed-in user from one agency uploading into another
 *     agency's listing folder.
 */
type UploadContext =
  | { kind: "avatar" }
  | { kind: "disposal-image"; disposalId: string }
  | { kind: "disposal-doc"; disposalId: string };

function parseContext(clientPayload: string | null): UploadContext {
  if (!clientPayload) throw new Error("Missing upload context.");
  const ctx = JSON.parse(clientPayload) as UploadContext;
  if (
    ctx.kind !== "avatar" &&
    ctx.kind !== "disposal-image" &&
    ctx.kind !== "disposal-doc"
  ) {
    throw new Error("Unknown upload context.");
  }
  return ctx;
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        if (!session?.user) throw new Error("You must be signed in.");

        const agencyId = await currentAgencyId(session.user.id);
        if (!agencyId) throw new Error("No agency is linked to your account.");

        const ctx = parseContext(clientPayload);

        if (ctx.kind === "avatar") {
          if (!pathname.startsWith("avatars/")) {
            throw new Error("Invalid upload path.");
          }
          // The avatar pathname is chosen entirely client-side and is not
          // scoped to the caller (an admin may set a teammate's avatar, so we
          // can't require it match the caller's own id). Forcing a random
          // suffix + no overwrite means an upload can never overwrite/deface an
          // existing avatar at a known path — the worst a caller can do is
          // create a fresh orphan blob, and the resulting URL is only ever
          // wired to a member by the separately-authorized updateAgent action.
          return {
            allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
            addRandomSuffix: true,
            allowOverwrite: false,
            maximumSizeInBytes: 5 * 1024 * 1024,
            tokenPayload: clientPayload,
          };
        }

        // "disposal-image" | "disposal-doc" — both scoped to a specific
        // listing the caller's agency actually owns.
        if (!pathname.startsWith(`${ctx.disposalId}/`)) {
          throw new Error("Invalid upload path.");
        }
        const disposal = await getDisposalById(agencyId, ctx.disposalId);
        if (!disposal) throw new Error("Listing not found.");

        return {
          allowedContentTypes:
            ctx.kind === "disposal-doc"
              ? ["application/pdf"]
              : ["image/jpeg", "image/png", "image/webp", "image/gif"],
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: 10 * 1024 * 1024,
          tokenPayload: clientPayload,
        };
      },
      // No-op: the calling component records the resulting `blob.url` via
      // its own server action (addDisposalImage / addDisposalDocument /
      // updateAgent) right after `upload()` resolves, rather than via this
      // webhook — which Vercel can't reach on localhost during dev anyway.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
