"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importEntityCsv } from "@/lib/actions/import-data";
import { decodeCsvBytes, IMPORT_TEMPLATES, toCsv, type ImportEntity } from "@/lib/csv";
import type { FormState } from "@/lib/actions/types";

function EntityImporter({ entity }: { entity: ImportEntity }) {
  const router = useRouter();
  const tpl = IMPORT_TEMPLATES[entity];
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(
    importEntityCsv,
    {},
  );

  React.useEffect(() => {
    if (state.message) router.refresh();
  }, [state, router]);

  function downloadTemplate() {
    const blob = new Blob([toCsv(tpl.headers, [tpl.example])], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (/\.(xlsx|xls)$/i.test(f.name)) {
      // Parse the first sheet of an Excel workbook to CSV, reusing the CSV pipeline.
      // Loaded on demand — xlsx is ~120KB gz and most sessions never touch it.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      setCsv(ws ? XLSX.utils.sheet_to_csv(ws) : "");
    } else {
      // Not f.text(): that decodes UTF-8 unconditionally and turns a
      // Windows-1252 export's apostrophes and pound signs into "" before the
      // importer ever sees them. See decodeCsvBytes.
      setCsv(decodeCsvBytes(await f.arrayBuffer()));
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{tpl.label}</p>
        <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
          <Download />
          Template
        </Button>
      </div>
      <form action={action} className="space-y-2">
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="csv" value={csv} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={onFile}
            aria-label={`Upload ${tpl.label} CSV or Excel`}
            className="block text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-2.5 file:py-1.5 file:text-xs hover:file:bg-muted"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !csv}>
            <Upload />
            {pending ? "Importing…" : "Import"}
          </Button>
        </div>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">{tpl.hint}</p>
      {fileName ? (
        <p className="text-xs text-muted-foreground">Selected: {fileName}</p>
      ) : null}
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.message ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{state.message}</p>
      ) : null}
    </div>
  );
}

/** Admin bulk-import grid (#8): CSV upload + downloadable template per entity. */
export function DataImport() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Download a template, fill it in, and upload it as CSV or Excel (.xlsx/.xls).
        Multi-value cells (tags, towns) are separated with “;” — a comma works too.
        Column names are matched loosely, so “First Name” and “first_name” are the same
        column; anything we can’t place is listed in the result rather than dropped.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <EntityImporter entity="companies" />
        <EntityImporter entity="contacts" />
        <EntityImporter entity="requirements" />
        <EntityImporter entity="listings" />
      </div>
    </div>
  );
}
