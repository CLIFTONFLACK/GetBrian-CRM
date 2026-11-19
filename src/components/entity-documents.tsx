"use client";

import * as React from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { addEntityDocument, deleteEntityDocument } from "@/lib/actions/entity-documents";
import { buildEntityDocPath, ENTITY_DOC_MAX_BYTES, type EntityDocType } from "@/lib/entity-docs";

// The raw Blob URL (file_path) is not part of this type on purpose: only the
// signed proxy link (`url`) goes to the browser. The delete action re-reads the
// row on the server.
export type EntityDoc = {
  id: string;
  name: string;
  size_bytes: number | null;
  url: string | null;
};

function formatBytes(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Documents of a company or contact. Uploads go from the browser straight to
 * Vercel Blob with a short-lived token from /api/blob/client-upload, which
 * checks the record belongs to the caller's agency and that the path is this
 * record's own. The row is then recorded by addEntityDocument.
 */
export function EntityDocuments({
  entityType,
  entityId,
  docs,
}: {
  entityType: EntityDocType;
  entityId: string;
  docs: EntityDoc[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      if (file.size > ENTITY_DOC_MAX_BYTES) throw new Error("The file is larger than 10 MB.");
      const path = buildEntityDocPath(entityType, entityId, file.name, Date.now());
      const blob = await upload(path, file, {
        access: "public",
        handleUploadUrl: "/api/blob/client-upload",
        clientPayload: JSON.stringify({ kind: "entity-doc", entityType, entityId }),
      });
      const fd = new FormData();
      fd.set("entity_type", entityType);
      fd.set("entity_id", entityId);
      fd.set("file_path", blob.url);
      fd.set("name", file.name);
      fd.set("size_bytes", String(file.size));
      fd.set("content_type", file.type);
      const res = await addEntityDocument({}, fd);
      if (res.error) setError(res.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      input.value = "";
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium text-foreground">{doc.name}</span>
                {doc.size_bytes != null ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(doc.size_bytes)}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Download ${doc.name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                ) : null}
                <form action={deleteEntityDocument}>
                  <input type="hidden" name="id" value={doc.id} />
                  <ConfirmSubmitButton
                    confirmMessage={`Delete "${doc.name}"? The file is permanently removed.`}
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${doc.name}`}
                    className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmSubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1 rounded-md border bg-muted/30 p-3">
        <label htmlFor={`entity-doc-file-${entityId}`} className="text-xs text-muted-foreground">
          Upload PDF (up to 10 MB)
        </label>
        <input
          id={`entity-doc-file-${entityId}`}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFile}
          disabled={uploading}
          className="block w-full text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1.5 file:text-xs hover:file:bg-muted disabled:opacity-50"
        />
        {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
