"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { linkCompanyNumber, runKyc } from "@/lib/actions/kyc";
import type { FormState } from "@/lib/actions/types";
import type { CompanySearchHit } from "@/lib/kyc/types";

type Co = {
  id: string;
  name: string;
  company_number: string | null;
  vat_number: string | null;
};

export function KycRunner({
  companies,
  selectedId,
}: {
  companies: Co[];
  selectedId?: string;
}) {
  const router = useRouter();
  const selected = companies.find((c) => c.id === selectedId) ?? null;

  const [crn, setCrn] = useState(selected?.company_number ?? "");
  const [vat, setVat] = useState(selected?.vat_number ?? "");
  const [q, setQ] = useState(selected?.name ?? "");
  const [results, setResults] = useState<CompanySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const [linkState, linkAction, linking] = useActionState<FormState, FormData>(
    linkCompanyNumber,
    {},
  );
  const [runState, runAction, running] = useActionState<FormState, FormData>(
    runKyc,
    {},
  );

  async function search() {
    const term = q.trim();
    if (term.length < 2) {
      setSearchErr("Type at least 2 characters.");
      return;
    }
    setSearching(true);
    setSearchErr(null);
    try {
      const res = await fetch(`/api/kyc/search?q=${encodeURIComponent(term)}`);
      const body = (await res.json()) as { results?: CompanySearchHit[]; error?: string };
      if (!res.ok) {
        setSearchErr(body.error ?? "Search failed.");
        setResults([]);
      } else {
        setResults(body.results ?? []);
        if ((body.results ?? []).length === 0) setSearchErr("No matches.");
      }
    } catch {
      setSearchErr("Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>KYC Companies House Search</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Company picker */}
        <div className="space-y-2">
          <Label htmlFor="kyc-company">Company</Label>
          <Select
            id="kyc-company"
            value={selectedId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              router.push(id ? `/kyc?company=${id}` : "/kyc");
            }}
          >
            <option value="">Select a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company_number ? ` (${c.company_number})` : ""}
              </option>
            ))}
          </Select>
        </div>

        {selected ? (
          <>
            {/* Registration details (manual + from search) */}
            <form action={linkAction} className="space-y-4 rounded-md border p-4">
              <input type="hidden" name="company_id" value={selected.id} />
              <p className="text-sm font-medium">Registration details</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company_number">Companies House number (CRN)</Label>
                  <Input
                    id="company_number"
                    name="company_number"
                    placeholder="e.g. 01234567"
                    value={crn}
                    onChange={(e) => setCrn(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vat_number">VAT number</Label>
                  <Input
                    id="vat_number"
                    name="vat_number"
                    placeholder="e.g. GB123456789"
                    value={vat}
                    onChange={(e) => setVat(e.target.value)}
                  />
                </div>
              </div>

              {/* Companies House search helper */}
              <div className="space-y-2">
                <Label htmlFor="kyc-search">Find the CRN on Companies House</Label>
                <div className="flex gap-2">
                  <Input
                    id="kyc-search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void search();
                      }
                    }}
                    placeholder="Search by company name…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void search()}
                    disabled={searching}
                  >
                    {searching ? "Searching…" : "Search"}
                  </Button>
                </div>
                {searchErr ? (
                  <p className="text-xs text-muted-foreground">{searchErr}</p>
                ) : null}
                {results.length > 0 ? (
                  <ul className="divide-y rounded-md border">
                    {results.map((r) => (
                      <li
                        key={r.companyNumber}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{r.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.companyNumber}
                            {r.status ? ` · ${r.status}` : ""}
                            {r.address ? ` · ${r.address}` : ""}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setCrn(r.companyNumber);
                            setResults([]);
                          }}
                        >
                          Use
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" variant="secondary" disabled={linking}>
                  {linking ? "Saving…" : "Save details"}
                </Button>
                {linkState.message ? (
                  <span className="text-sm text-emerald-700 dark:text-emerald-300">
                    {linkState.message}
                  </span>
                ) : null}
                {linkState.error ? (
                  <span className="text-sm text-red-700 dark:text-red-300">
                    {linkState.error}
                  </span>
                ) : null}
              </div>
            </form>

            {/* Run */}
            <form action={runAction} className="flex items-center gap-3">
              <input type="hidden" name="company_id" value={selected.id} />
              <Button type="submit" disabled={running}>
                {running ? "Running…" : "KYC Companies House Search"}
              </Button>
              {!selected.company_number ? (
                <span className="text-sm text-muted-foreground">
                  Tip: link a CRN above for full Companies House data.
                </span>
              ) : null}
              {runState.message ? (
                <span className="text-sm text-emerald-700 dark:text-emerald-300">
                  {runState.message}
                </span>
              ) : null}
              {runState.error ? (
                <span className="text-sm text-red-700 dark:text-red-300">
                  {runState.error}
                </span>
              ) : null}
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a company to link its registration number and run a report.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
