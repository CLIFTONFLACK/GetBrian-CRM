# Lessons

Patterns captured to avoid repeating mistakes. Review at session start.

## Deployment / Vercel
- **`READY` ≠ serving.** A Vercel deployment can reach state `READY` (build exited 0) yet
  return 404 on every route. Verify the actual HTTP response of a real route — not just
  build status or build logs — before claiming a deploy works.
- **Vercel projects created via API/MCP come up with `framework: null`.** Git-connecting
  them does NOT set the Next.js preset, so no serving function is registered → every route
  404s and the project stays `live:false`. Fix: commit `vercel.json` with
  `{"framework":"nextjs"}` (or set the preset in the dashboard). (commit `4b27aa3`)
- **Don't declare success prematurely.** I reported the first deploy as working off `READY`
  + clean build logs; the apex actually 404'd. Always verify end-to-end with a real request.

## Next.js 16 (this repo)
- Runs **Next.js 16.2.9** with breaking changes vs training data (e.g. `middleware` appears
  to be renamed/replaced by **`proxy`**). Per `AGENTS.md`, **read
  `node_modules/next/dist/docs/` before writing any framework code.** Offload that doc
  reading to subagents/workflows to keep the main context clean.

## Next.js App Router — "use client" module exports
- **A `"use client"` module's exports reach the server as client *references*, not values.**
  Exporting `const PATH = "/submit-requirement"` from a client component and importing it
  into a Server Component gave a stub function, which interpolated into the page as
  `http://host` + `function(){throw Error("Attempted to call PATH() from the server…")}`.
  `tsc` and `eslint` were both clean — only looking at the rendered page caught it.
  Put shared constants in a plain module (or define them in the server file).

## PowerShell (the user's shell is Windows PowerShell 5.1)
- **`&&` is a parser error there.** Don't hand over bash-style `cmd && cmd` chains. Use
  `cmd; if ($?) { cmd }`. (Handed over a broken push chain on 2026-07-28.)

## Workflow scripts
- Workflow scripts are plain JS: do **not** put literal backticks inside backtick-delimited
  template-literal prompts (closes the string early). Use single quotes for inline code.

## Git in a shared working tree (multiple sessions, same repo)
- **Never `git add -A` here.** Parallel sessions (e.g. the disposals / agent-assignments
  workstreams) drop untracked files into this same working tree; `git add -A` sweeps their
  WIP into your commit. Stage explicit paths for the files you actually changed.
- The global `gh` active account drifts between `CLIFTONFLACK`, `slapharma` and
  `dominicmerlow` (other sessions switch it). Switch unconditionally before every push —
  a status check first is a verification that cannot fail, because the account can drift
  between the check and the push.
- **This repo's remote is `CLIFTONFLACK/GetBrian-CRM`, so the account is `CLIFTONFLACK`:**

  ```
  gh auth switch --user CLIFTONFLACK
  ```

  **Corrected 2026-09-09.** This note previously said `slapharma` / `slapharma/SLC-CRM`,
  which is a repo this project no longer pushes to. Acting on it produced a push command
  that could only 403 — handed over twice in one session before anyone ran `git remote -v`.
  Match the account to the *current* remote owner, read from `git remote -v`, not from a
  note written when the repo lived somewhere else.

## A migration runner with no version table is not a migration runner

`scripts/run-migrations.mjs` reads as "applies db/migrations/*.sql in filename
order" and is easy to hand over as *the* way to migrate. It replays **every**
file from 0001 on every run and tracks nothing, and twelve of those files carry
unguarded `create table` / `create type` / `create index`. Against a database
that already has a schema it dies on `0001_init.sql` with "relation already
exists" and never reaches the new migrations.

**Cost (2026-09-08):** handed Brian `node scripts/run-migrations.mjs` as the
deploy step for five new migrations. It could only ever have failed on the first
file. Caught before he ran it, by checking the older files for `if not exists`
rather than trusting the script's own docstring.

**Rules:**
- Before recommending any migration runner, check whether it records what it has
  already applied. No version table means it is a build-from-empty tool.
- Grep the existing migrations for unguarded DDL (`create table` /
  `create type` / `create index` without `if not exists` or an
  `exception when duplicate_object` guard) before assuming a replay is safe.
- Write new migrations idempotently anyway — `add column if not exists`,
  `create table if not exists`, guarded enum creation — so re-applying one
  costs nothing.
- Put the migration that *can* legitimately fail last in filename order. A
  single-pass runner takes every later file down with it.

## Verify a constraint by trying to violate it, not by checking it exists

Confirming `pg_indexes` contains `companies_agency_name_uniq` proves a row in a
catalogue, not that anything is enforced — a non-unique index of the same name
would pass that check. After applying the 0038/0041 indexes, the real check was
to `insert` a duplicate company name and a second primary contact inside a
transaction, watch both get rejected, `rollback`, and then confirm no test rows
survived. That is three assertions where the catalogue query was zero.
