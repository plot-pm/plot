# Panel moderation: github-reads-in-process

Subject: `docs/plans/2026-11-09-github-reads-in-process.md`. Round 1. Jurors: correctness, cost, operator.

## Reconcile

`plot-panel.mjs reconcile` answers:

```
unanimous	amend	correctness,cost,operator
```

All three jurors hold `amend`. The positions agree. Three of the amendments below do not: each juror proposes a different answer to the same question, and the moderation names each one under *Disagreements*.

## What each juror looked at

| Juror | Read | Ran or measured |
|---|---|---|
| correctness | The plan, the story (Target Shape, Phases 5–6, Decisions), `CLAUDE.md`, `plot-host.sh`, `rules/scan-listing.ts`, `rules/listing-page.ts`, `ports/host.ts`, `ports/slots.ts`, `pr-refresh.ts`, `fleet-scan.ts` | Nothing ran. Every finding is a reading of code with a line number. |
| cost | The plan, `census-rows.ts`, `budget-file.ts`, `slots-file.ts`, the three `spend-rate` call sites | Counted images in `census-head.jsonl` from CI run 42595561157 (artifact `census-report-head`): about 180 host-call images per idle pass on the 0-desk fixture (16 % of S4), about 246 on the 3-desk fixture (10 %). The only juror with a measurement. |
| operator | The plan, `ports/host.ts`, `rules/refusal.ts`, `registryd-main.ts`, the fleetd launchd plist | Nothing ran. Every finding is a reading of code. |

The moderator checked six claims against the code: `HostRefusal.kind` is `'throttled' | 'secondary' | 'failed'` (`ports/host.ts:88`), so the plan's refusal kind `auth` does not exist; the GitHub `pr-list` arm overlays Jenkins when `ci_scheme` answers `jenkins` (`plot-host.sh:4583-4600`); `budget-file.ts:145` performs no rotation; `withHostSlot` wraps the `pr-list` calls at `pr-refresh.ts:1441` and `:1566`; `hostReaction` classifies by message text (`pr-refresh.ts:488`); S4 has no `green` flag and waits on Phase 8 (`census-rows.ts:42-48`). All six hold.

## Shared or uncontested amendments

Applied to the plan:

1. **"Whole" for an in-process walk.** A state is `whole` only where the last page reports `hasNextPage: false` and the rows number fewer than the limit. A walk refused on any page is never `whole` (correctness 1, operator 5; cost names the 5-page merged read as the common case). The row-count rule alone is safe for `gh` only because `gh pr list` is all-or-nothing.
2. **A refusal reaches the same backoff.** The in-process client puts GitHub's response `message` verbatim into `said`, and records `Retry-After` and `X-RateLimit-Reset`, so `refusalKind` and `hostReaction` classify an in-process `403` secondary refusal as they classify the shell's exit 6 (correctness 3, operator OQ1). `Host.observe` alone acts only on `throttled`.
3. **GitHub with `CI: jenkins` keeps the shell route** until Phase 7 (correctness 2).
4. **One slot per request.** The client claims the slot, and `withHostSlot` stops wrapping `prListing` (correctness 6). A pass holds no more requests in flight than the `Slots` bound (cost).
5. **`actual` ledger lines change shell routing.** A contract row: a client-written `graphql` line with remaining 0 routes `pr-state` to REST (correctness 5).
6. **Corpus fixture shapes and the `gh` version** (correctness 7).
7. **GitHub Enterprise.** The API host comes from the `origin` remote, and the token from `gh auth token --hostname <host>` (correctness 8).
8. **The transport is visible.** fleetd logs the transport, the reason and the token source (never the token) once at start, publishes the transport with its heartbeat, and `/plot-fleet --status` prints it. No silent fallback to the shell (all three).
9. **The rollback switch has a procedure.** `PLOT_HOST_TRANSPORT=shell` goes into the unit's `EnvironmentVariables` and takes a reload through `plot-fleetctl.sh`. The census runs with the switch unset (operator OQ3, cost OQ3).
10. **A token from the environment gets no refresh.** `gh auth token` returns `GH_TOKEN` when it is set, so a `401` on an environment token answers at once, and `said` names the variable. With the token from `gh`, the next `401` reads the new token after `gh auth login`, with no restart (operator 1, 2).
11. **The plan's refusal kind `auth` is a factual error.** No such kind exists in `HostRefusal` or `RefusalKind`. The plan now states the fix sentence in `said` and leaves the union as an open question.
12. **Residue named.** `spend-rate` (3 call sites, about 2.5 `plot-host.sh` trees per idle pass), `plot-merger-token.mjs` (1 per pass) and `plot-issue-source.mjs` (1 per 2 passes) stay after the cutover (correctness 9, cost).
13. **A green per-source census row.** `P5: an idle fleetd pass on GitHub starts no plot-host.sh pr-list or issue-list`, `green: true` from the Cutover slice, with a stub-server request count that does not exceed the baseline (cost 1). Without it S4's `it.fails` holds nothing.
14. **Slice 1's tolerance names S5 and S6.** S4 has no tolerance; it is a strict row expected to fail (cost).
15. **An expected number.** The Cutover slice states about 150–250 fewer `execve` per idle GitHub pass, and about 20 `pr-list` calls in 2 passes to 0 (cost 6). `runsForSha` removes nothing from S4, S5 or S6, because it runs once per half `Checks wait` (cost).

## Disagreements

1. **What a walk refused mid-way returns.** Correctness: `failed`, no rows, never `partial`. Operator: the rows of the pages read, `possibly-truncated`, and `lastRefusal()` holding the kind and the verbatim message. The existing contracts side with the operator in shape: `hostSaid` already has a `partial` answer (exit 7) that keeps its rows, and `mergedBranches` states *"A PARTIAL ANSWER KEEPS ITS ROWS AND IS NOT WHOLE"* (`registryd-main.ts:918`). Correctness's case is that the in-process walk is a new partial source on GitHub, where `gh` never produced one. Both agree it is never `whole`, and that part is applied.
2. **How the client names the budget account.** Correctness: duplicate `budget_account` (`PLOT_BUDGET_ACCOUNT`, then the first `user:` in `hosts.yml`, then `unknown`) as `rules/budget-account.ts` with a corpus row, never `/user`. Cost: read `hosts.yml` once in-process, no process per request. Operator: the first `user:` goes stale after `gh auth switch` while the cached token still spends the old account; take the account from the token (`GET /user`) or re-read the token when `hosts.yml` changes. Correctness's rule keeps both writers on one key; the operator's rule follows the token that spends. They cannot both be the key.
3. **Whether `auth` becomes a refusal kind.** Correctness adds `auth` and `timeout` to a typed failed kind that callers pass to `reactionTo`. Operator accepts either a new `auth` kind in both `HostRefusal` and `RefusalKind` with a board sentence, or `failed` with the fix in `said`. The verbatim `said` with the fix is applied; the union is not.

## Shared blind spot

All three lenses read the request as a function of the token and the rate limit. None read the network path between Node and GitHub.

- **Proxies.** `gh` honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`. Node's HTTPS client ignores them unless the process sets `NODE_USE_ENV_PROXY=1` or passes an agent. No source file under `packages/` or `skills/plot/scripts/` names a proxy variable (only the bundles `board-server.mjs` and `plot-worker-loop.mjs` carry library text). On a machine behind a proxy, the shell route works today and the in-process route fails every read with a connection error, which classifies as `outage`. Added to *Open Questions*.
- **A request bound.** `hostSaid` passes no `timeoutMs` (`scripts-shell.ts:118-121`), so the shell route is bounded only by `gh`. The plan names no bound for an in-process request, and a stalled socket holds the pass and its slot. Added to *Open Questions* with the proxy item.

## Leftovers for the person

1. **GraphQL or REST for the deltas?** Options: keep GraphQL for every read in this plan; or move the `--state all` delta, the merged delta and the issue read to REST (`core` bucket) now. All three jurors: keep GraphQL here, on the condition that a secondary refusal reaches the same backoff (applied).
2. **Which identity reads where no person is signed in to `gh`?** Options: `GH_TOKEN`/`GITHUB_TOKEN`, no new key; or a fourth App key `Reader app`. All three jurors: no new key in this plan.
3. **How long does `PLOT_HOST_TRANSPORT=shell` live?** Options: remove it with `triggers-replace-the-tick`; remove it at this plan's delivery; keep it. All three jurors: remove it in `triggers-replace-the-tick`.
4. **Does the merged full read keep `--limit 500`?** Options: keep it; move the full read to the 24-hour `PR_FULL_READ_MS` cadence. All three jurors: keep it in this plan.
5. **A walk refused mid-way: rows or no rows?** Options: `failed` with no rows (correctness); the rows read, `possibly-truncated`, and the refusal (operator, and the existing `partial` shape).
6. **The budget account key?** Options: duplicate `budget_account` from `hosts.yml` (correctness, cost); the login of the token in use, or a re-read on a `hosts.yml` change (operator).
7. **A refusal kind `auth`?** Options: add `auth` to `HostRefusal` and `RefusalKind` with a board sentence (correctness, operator option a); keep `failed` with the fix in `said` (operator option b).
8. **Who rotates `budget.tsv` after the cutover?** Options: the client rotates in-process as a declared duplicate of `budget_rotation_due` with a corpus row; or `plot-budget.sh` runs on a named trigger. Cost raised it; no juror chose.
9. **Is `spend-rate` in scope?** Options: move it to a `BudgetRecord` read in this plan; or leave it as named residue for a later plan. Correctness and cost both ask that the plan choose; neither chose.
10. **Proxy and request bound (moderator).** Options: the client honours the proxy variables `gh` honours and bounds each request; or the composition falls back to the shell where a proxy variable is set.
