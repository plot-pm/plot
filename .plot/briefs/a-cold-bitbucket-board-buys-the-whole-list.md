## Implementation brief — a-cold-bitbucket-board-buys-the-whole-list

- **Plan (canonical):** `docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-cold-bitbucket-board-buys-the-whole-list` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1050

Single-slice plan; nothing waits on it. Its sibling is `bug/a-state-sweep-is-one-request` (#1049, plan `docs/plans/2026-09-28-a-state-sweep-is-one-request.md`), which collapses the per-state loop in the same `pr-list` arm. Neither branch was claimed at dispatch (2026-09-29). Read that plan before you start: whichever branch lands second rebases onto the other and says in its PR what remains of the other.

### What to build

A Bitbucket board with a warm PR store still buys the full PR listing on every refresh. `fleet.ts:2848` computes a window with `prWindowFor` and `fleet.ts:2862` passes `--since <watermark>`. The Bitbucket arm of `plot-host.sh pr-list` then clears it (`plot-host.sh:3753-3757`) and prints `bitbucket ignores --since … answering in full`, because `bb pr list` has no query flag. On `quatico/quaweb-website` that is 895 merged PRs re-bought per refresh, against 9 rows in the measured window.

Build the missing path: when `--since` is set and no `--branch` is given, the Bitbucket arm asks `bb api` for `/repositories/{ws}/{repo}/pullrequests?q=state="<S>" AND updated_on>="<since>"&pagelen=50`, once per state. The plan measured this: one request, `size: 9`, where `size` is the server's match count and not a page length.

The code already exists in pieces. `bb_branch_query` (`plot-host.sh:769-802`) builds exactly this `q=`, including the window term, the encoding and the leading slash. The only difference is its `source.branch.name` clause. `bb_branch_sweep` (`:831`) shows how a non-`bb pr list` command sits in `pr_list_states`' slot: it accepts the trailing `--state <s> --json` and prints one JSON array. A windowed listing is a third command in that slot. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**`q=` through `bb api`, not a sweep and not `--limit`.** The plan's round-1 table (`## Design`) rules out the other three options. A sweep costs branches × states and never beats a windowed listing at any working-set size. The full listing costs the same number of calls for 895 rows instead of 9. Narrowing by `--limit` over an `updated_on`-sorted union crowds open PRs out on a merge-heavy repository. Do not build that option, and do not build a guard for it.

**The slice line says "measure the crossover". The Design section supersedes it.** Round 1 bounded the crossover by reading `bb_branch_sweep`'s loop: against a windowed listing, the sweep never wins. The slice text predates that round. Do not spend time on a crossover measurement.

**`plot-host.sh:3744-3745` is a stale comment, not a boundary.** It says `bb_branch_query`'s `q=` is the only Bitbucket path that can carry `updated_on`. That was true of the code, not of Bitbucket. Rewrite the comment block at `:3741-3752` to state the current behaviour: a windowed listing goes through `q=`, and the report stays only for a path that still cannot narrow.

**The states travel inside `q=`, never beside it.** `bb`'s own `bb_pr_list_query` records why: Bitbucket lets `q=` silently override `state=`, so `?q=state="OPEN"&state=MERGED` returns OPEN only. Map each adapter state through `bb_query_state` (`:702`) inside the expression, as `bb_branch_query` does.

**One request per state, as today.** `pr_list_states` (`:963`) owns the states loop, the partial-answer rule (exit 7, `PR_LIST_PARTIAL_RC`) and the error classification in `pr_list_call`. Put the windowed command in its slot. Do not give it a loop of its own. An `OR` of states in one `q=` is #1049's question; leave it to that branch.

**GitHub is untouched.** It already honours `--since` as `--search "updated:>…"` (`host.test.mjs:5187`).

**The store and the board change nothing.** `prWindowFor` (`packages/domain/src/rules/pr-index.ts`) already refuses a window for no store, no watermark, `complete: false` and an expired `at`. `fleet.ts:2984` sets `complete = window.complete && partialSaid === null`, and `window.complete` is `false` for every windowed call. So the board folds a windowed answer as a merge and never as a replacement. That guard is already in place; do not move it into the adapter.

### The two traps a naive implementation walks into

**A window with more than 50 matches.** `bb api` makes one `bb_api_call` and returns ONE raw page; only `bb pr list` follows `next` through `bb_paginate`. After a busy week or a long board outage, a window can hold more than 50 rows. If the adapter prints the first 50 and exits 0, the board folds them and advances its watermark past rows it never saw. Those rows then stay missing until the next full read (`PR_FULL_READ_MS`). This is the silent corruption the plan's third `Done when` item names. The response carries `size` and `next`: follow `next` until it is absent, or refuse the window and fall back to the full listing with the report. Either way, the adapter must never print a short window as whole. Assert it with a stub that answers `size: 51` across two pages.

**The truncation detector fires on every Bitbucket page.** `pr_list_report_truncation` (`:2406`) reports any non-empty Bitbucket page as "possibly truncated" when `--limit` is set, and the board always passes `--limit`. A windowed page has an exact `size`, so that report would contradict a complete answer on the same stream. `pr_list_states` already skips the detector for a sweep (`[ -n "$PR_LIST_BRANCHES" ] ||`, `:1003`). Give the windowed path the same exemption. Report truncation from `size` against the rows returned instead.

### Rules carried over

- **Absent is not false.** A missing row still means "ask the host", never "no PR". The window changes what is asked, not how an absence reads.
- **The report stays for any path that cannot narrow.** Where `--since` arrives and the window is NOT applied, the `ignores --since` line still prints and `PR_LIST_SINCE` is still cleared. The report goes away only where the window was applied.
- **Encode like `bb_branch_query`:** `url_encode` on each value, operators and `AND` literal, spaces as `%20`, `>=` and not `>` (Bitbucket's `updated_on` carries microseconds), and a leading `/` on the path (without it the call is a 403 that reads as a scope error).
- **Error text travels raw.** `bb_branch_query` returns `bb`'s exit code and stderr untouched, and `pr_list_call` classifies once. A windowed command follows the same rule, so a `429` still reads as a rate limit.

### Done when

The plan's `## Done when` list is the specification. Each of these assertions exists because a naive implementation passes without it:

- **The windowed call's answer is the server's match count.** Use a stub with more than 50 merged PRs and assert on `size`, not on a page length. This catches an implementation that reuses `bb pr list --limit` and calls it narrowed.
- **A window of more than 50 matches is either paged to the end or refused.** This catches the first trap above.
- **Exactly one `q=`, and the state clause inside it.** Assert that no `state=` query parameter appears beside `q=`. This catches the silent-override failure `bb` records.
- **`test/reconcile/host.test.mjs:5291`, *"a bitbucket LISTING says it cannot narrow, and answers in full"*, is rewritten, not deleted.** It asserts the old behaviour this plan removes. Replace it with a test that a windowed listing carries `updated_on>=` and prints no `ignores --since` line. Keep one test that a path which still cannot narrow does report.
- **GitHub's `--since` tests (`host.test.mjs:5187-5245`) pass unedited.**
- **The PR body says two things:** the fleet scan is out of scope (`plot-fleet-scan.sh` passes no `--since`, so its benefit is only a smaller share of the shared account budget), and what this branch leaves for #1049, or what #1049 already took.

Plus the repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck`. Do not run `pnpm run test:e2e` locally; CI runs it. Add a changeset for package `plot` with the description first and a `bumps:` block last (`plot: patch`) and `plan: docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md`. No board artifact rebuild is needed unless `packages/board` changes, and this plan changes nothing there.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work is moving). Do not run `gh pr create`.
- When the PR exists, record it inside the slice heading in the plan's `## Slices` section: `(Branch: bug/a-cold-bitbucket-board-buys-the-whole-list, PR: #<number>)`. A trailing arrow outside the heading parses as no PR.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh`: the Bitbucket `pr-list` arm (`:3741-3757`) and one new windowed-listing command beside `bb_branch_query`/`bb_branch_sweep`
- `test/reconcile/host.test.mjs`: the `--since` block (`:5173-5315`)
- one `.changeset/*.md`

It does not touch `packages/board/src/server/fleet.ts`, `packages/domain/src/rules/pr-index.ts`, `plot-fleet-scan.sh` or the GitHub arm.

In flight at dispatch (2026-09-29): `origin` held only `main` and `changeset-release/main`. `bug/a-state-sweep-is-one-request` (#1049) is approved and unclaimed. It edits the same `pr_list_states` call sites in the same arm, so expect a conflict in `plot-host.sh` if both run at once. Resolve it by keeping both behaviours, not by taking a side.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
