# Research: board.plot.pm — running the board as a public server

> **Research only — not committed, not part of the approved plan.** Options for Max to react to; nothing here is scheduled or implied by the kanban-board-v1 plan. (The plan's package split does, deliberately, keep these options open.)

**Question (R2):** Could board.plot.pm serve the board frontend publicly? Two explored modes: **(A)** detect and list locally running boards; **(B)** read any GitHub repo via API and render its plot board for the main branch.

## What the kanban-board-v1 plan already buys us

After the planned split, the board is a static React app + a zod-validated `Board` JSON contract. A public deployment is "serve the same static bundle from a CDN and swap the data source" — the expensive part (a real frontend with a typed contract) is already paid for.

## Mode A — Detect local boards

A page on board.plot.pm lists boards running on the visitor's machine (localhost:7777 etc.) and links or proxies to them.

**How detection could work, and why it's hostile territory:**

- **HTTPS page → `fetch("http://localhost:7777")`** is mixed content; browsers block it. Chrome's Private Network Access (PNA) rules further gate public→local requests behind a preflight the local server must opt into (`Access-Control-Allow-Private-Network: true`), and Chrome has been rolling toward requiring device permission. Safari/Firefox behavior differs. This direction is fighting the platform, and it *should* be hard — "public website probes your localhost" is an attack pattern (the DNS-rebinding/port-scanning story that got Zoom and eBay bad press).
- **Registration instead of probing:** local boards phone home ("board `plot` up at localhost:7777, repo plot-pm/plot") and board.plot.pm lists *registered* boards per visitor (cookie/account). Privacy: leaks repo names + liveness to a third-party service; needs identity to scope who sees what.
- **Practical middle ground:** no server at all — a static page with a `localhost:7777`-first **link list** (links, not fetches: navigation to http://localhost is allowed where fetch isn't), plus instructions. Or skip the website: `npx @plot-pm/board` locally already solves "easy access" without a discovery service.

**Verdict candidate:** weak value for real cost and security smell. The genuinely useful variant ("access my board from another device") is better served by tailscale/`HOST=0.0.0.0` (the current server already prints a tailscale URL) than by a public discovery page.

## Mode B — Read any GitHub repo via API

board.plot.pm/`owner/repo` renders the plot board for that repo's main branch: fetch `docs/plans/` (+ `docs/sprints/`, `docs/stories/`) via the GitHub API, parse, render columns.

**Architecture options:**

1. **Pure static SPA, client-side GitHub calls.** No backend at all — the browser calls `api.github.com` directly (CORS is open).
   - Unauthenticated: 60 req/h per IP; a board render costs ~1 + N requests naively, or ~2 using the git-trees + tarball/`git/blobs` batching — tight but survivable for public repos with caching.
   - Private repos / higher limits: GitHub OAuth (device flow or a tiny token-exchange worker) — the token stays in the browser.
   - **Catch:** the parser. The plan makes `plot-plan-meta.sh` the only parser — a browser can't run it. A public board needs either (a) a TS re-implementation validated against the *same* `test/reconcile/fixtures/` (contract-by-fixtures makes a second implementation tolerable — the fixtures, not the awk, are the contract), or (b) WASM bash — no. This is the one real architectural fork to decide *before* building Mode B.
2. **Thin edge worker (Cloudflare Worker/Pages Functions).** Worker fetches + parses + caches per repo/ref, serves `Board` JSON to the same static frontend. Solves rate limits (server-side token + cache), keeps the client identical to the local board (it already speaks `Board` JSON). Private repos via GitHub App installation instead of user tokens.
3. **GitHub Action publishing static JSON.** Adopting repos run a plot action that renders `board.json` (using the real `plot-plan-meta.sh`!) to Pages/artifact; board.plot.pm just visualizes published JSON. Zero API-limit problems, uses the canonical parser, but only shows repos that opt in — which may be exactly right for plot's opt-in philosophy.

**Manifesto tension to name honestly:** Q1 asks "does it keep planning in git, or introduce an external dependency?" A read-only public *viewer* doesn't move the database — git remains truth — but plot itself would, for the first time, run a service. Option 3 keeps plot pure convention (a repo publishes its own board); options 1–2 make plot-pm an operator.

## Verdict candidates

- **Mode B ≫ Mode A.** Mode B has a real audience (share a board link in a PR/standup; view any adopter's board); Mode A fights browser security for something tailscale already does.
- Cheapest credible path: **B-option-1** (static SPA + client-side API, public repos only, unauth + optional PAT) as an experiment on Pages — no service to operate. Graduate to the worker (B-2) only if rate limits or private repos demand it. Consider B-3 as the philosophically cleanest long-term shape.
- Prerequisite either way: decide the parser fork (TS parser validated against shared fixtures) — worth raising in challenge-the-plan even though v1.0 doesn't need it, because it affects whether the zod contract layer should be published as a separate entry point of `@plot-pm/board`.
