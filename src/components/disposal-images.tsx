"use client";

import * as React from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Label } from "@/components/ui/label";
import {
  addDisposalImage,
  deleteDisposalImage,
} from "@/lib/actions/disposal-images";

const MAX_BYTES = 10 * 1024 * 1024;

export type DisposalImage = { url: string; alt?: string | null };

/**
 * Photo manager for a listing — upload to Vercel Blob client-side (a public
 * store, like the scrape media re-host, so the gallery and the PDF hero can
 * use plain URLs — unlike the private `disposal-docs` documents), then
 * record the `{url}` entry in `disposals.images` via a server action. The
 * detail-page gallery and the PDF hero read that same jsonb, so uploads
 * appear there with no further wiring.
 *
 * `upload()` never sees `BLOB_READ_WRITE_TOKEN` — it first fetches a
 * short-lived, path-scoped client token from
 * src/app/api/blob/client-upload/route.ts, then streams the file straight
 * to Blob (bypassing any serverless function body-size limit).
 */
export function DisposalImages({
  disposalId,
  images,
}: {
  disposalId: string;
  images: DisposalImage[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image is too large (max 10 MB).");
      e.target.value = "";
      return;
    }
    setUploading(true);
    setError(null);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${disposalId}/${Date.now()}-${safe}`;
    try {
      const blob = await upload(path, file, {
        access: "public",
        handleUploadUrl: "/api/blob/client-upload",
        clientPayload: JSON.stringify({ kind: "disposal-image", disposalId }),
      });
      const fd = new FormData();
      fd.set("disposal_id", disposalId);
      fd.set("url", blob.url);
      const res = await addDisposalImage({}, fd);
      if (res.error) setError(res.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = "";
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No photos yet — upload some below to give the listing a gallery and a
          PDF hero image.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((img, i) => (
            <div key={img.url} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.alt ?? `Listing photo ${i + 1}`}
                className="h-32 w-full rounded-md border object-cover"
              />
              <form
                action={deleteDisposalImage}
                className="absolute right-1.5 top-1.5"
              >
                <input type="hidden" name="disposal_id" value={disposalId} />
                <input type="hidden" name="url" value={img.url} />
                <ConfirmSubmitButton
                  confirmMessage="Remove this photo? The file is permanently deleted."
                  variant="secondary"
                  size="icon"
                  aria-label={`Delete photo ${i + 1}`}
                  className="h-7 w-7 bg-background/80 text-muted-foreground shadow-sm hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </ConfirmSubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
        <div className="space-y-1">
          <Label htmlFor="image-file" className="text-xs text-muted-foreground">
            Upload photo
          </Label>
          <input
            id="image-file"
            type="file"
            accept="image/*"
            onChange={handleFile}
            disabled={uploading}
            className="block w-full text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1.5 file:text-xs hover:file:bg-muted disabled:opacity-50"
          />
        </div>
        {uploading ? (
          <p className="text-xs text-muted-foreground">Uploading…</p>
        ) : null}
        {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
