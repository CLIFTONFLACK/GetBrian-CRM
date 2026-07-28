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
- The global `gh` active account flips between `slapharma` and `dominicmerlow` (other
  sessions switch it). Before any push run `gh auth switch --user slapharma` — only that
  account can push to slapharma/SLC-CRM.
