## Implementation brief — a-state-sweep-is-one-request

- **Plan (canonical):** `docs/plans/2026-09-28-a-state-sweep-is-one-request.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-state-sweep-is-one-request` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1049

Single-slice plan; nothing waits on it. Its sibling is `bug/a-cold-bitbucket-board-buys-the-whole-list` (#1050, plan `docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md`, brief `.plot/briefs/a-cold-bitbucket-board-buys-the-whole-list.md`). That branch adds a `--since` windowed listing to the same Bitbucket `pr-list` arm, one request per state, and leaves the multi-state question to this branch. Read its brief before you start. Whichever branch lands second rebases onto the other and says in its PR what it kept of the other.

### What to build

On Bitbucket, `plot-host.sh pr-list --state all` calls `bb pr list` three times, once per state (`bb_states_for all` at `plot-host.sh:1811`, looped by `pr_list_states` at `:963`). `bb` 1.9.0 accepts `--state` repeatedly and states in its own help that `--state open --state merged` *"covers both, in one API call"*. Its source (`bin/bb`, `bb_pr_list_query`) builds one URL with repeated `state=` params. Collapse the Bitbucket `--state all` listing to one `bb pr list --state open --state merged --state declined --json` call when `bb` supports it.

The loop was right when written. `plot-host.sh:1800-1805` records a measurement against `bb` 1.0.0 on 2026-08-18: repeated `--state` silently kept the last one, and 50 PRs came back, all MERGED, with the 3 open ones gone. The fix must not bring that failure back, either through an older `bb` or through the page budget below. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Probe the capability through `--help` and cache it. Never compare versions.** Two unrelated products are called `bb` (craftamap's Go binary and Quatico's shell script, `plot-host.sh:1896`), so a version number orders nothing. Follow `bb_identify` / `bb_require_json` (`:1929-2053`): one probe per run, the answer in a `BB_CAP_*` variable. The Quatico 1.9.0 help carries the line `May be repeated to cover several states:` under `--state`. **A probe that does not find it answers "not repeatable", and the adapter keeps today's per-state loop.** That fallback is the whole guard against 1.0.0 and craftamap. Under `PLOT_BB_SKIP_CAP_CHECK` the probe answers "not repeatable" too, so no test gets the new path without asking for it.

**A partial answer is unreachable on the one-call path.** The plan settled this by reading `bb`: one URL, and Bitbucket builds the union on the server. One request succeeds or fails whole. So retire the Bitbucket multi-state partial test (`test/reconcile/host.test.mjs:1040`, *"keeps the states that answered when one fails, and exits partial"*) deliberately, with a comment or commit message that states the reason. Keep `PR_LIST_PARTIAL_RC` and `pr_list_states` as they are: the per-state fallback still uses them.

**`bb pr list` 1.9.0 has no `--limit`, so "an explicit limit reaches `bb_paginate`" cannot happen through the CLI.** Measured at dispatch: `bb pr list --help` lists `--state`, `--author`, `--json` and `--jq` only, and `bb pr list` calls `bb_paginate "$path"` with no limit, so the default `local limit="${1:-50}"` applies. `--limit` exists only on `bb download list`. The plan allows two answers, and the choice is this branch's:

1. **Record the truncation as an accepted trade.** One call returns the 50 most recently updated PRs across all three states, where three calls returned up to 50 per state (150). State the trade in the code comment and in the PR with the numbers.
2. **Page the union yourself through `bb api`** with repeated `state=` and `pagelen=50`, following `next` until the limit. `bb api` makes one call and returns one raw page (the sibling brief measured this). The sibling branch needs the same `next`-following pager for its windowed listing, so if you build one, build it once and tell the sibling in the PR.

Do not pick a third answer (for example, keeping three calls whenever `--limit` exceeds 50) without reporting it. That would make the collapse reachable only on requests no caller sends.

**GitHub is untouched.** `--state all` is native there and never reaches this arm. `host.test.mjs:1133`, *"the GitHub arm makes ONE call and cannot answer partially"*, must pass unedited.

### Findings at dispatch the plan did not have

**The fleet scan does not use this listing.** The plan's motivation counts `plot-fleet-scan.sh:894` as 1 + 3 → 1 + 1. But the scan passes `--branch` for every tracked branch (`plot-fleet-scan.sh:868-869`), and with branches the Bitbucket arm routes through `bb_branch_sweep` (`plot-host.sh:831`), which queries per branch per state through REST `q=`. The plain listing runs for the scan only when `TRACKED_BRANCHES` is empty. **The caller that pays for the three-call listing is the board's `refreshPrs`**, budgeted at `PR_REQUESTS_PER_REFRESH.bitbucket = 4` (`packages/board/src/server/fleet.ts:200-225`: three listings plus `issue-list`). Say this in the PR.

**Do not change that constant on this branch.** After this change the cost depends on the probe's answer: 2 with a repeatable `bb`, 4 without. A fixed 2 would under-budget every older `bb`. Changing the constant is a cadence decision. Report the new figure in the PR and leave the constant for a follow-up.

**The sweep path must keep one state per call.** `bb_branch_sweep` parses exactly one `--state` (`_st="${2:?}"`, the last one wins) and builds `q=` from it. If the collapsed call ever reaches it, the sweep keeps only the last state, which is the 1.0.0 defect reproduced inside the adapter. Collapse the listing only (`PR_LIST_BRANCHES` empty). A sweep keeps the per-state loop.

**`pr-state` has its own `bb_states_for all` loop** (`plot-host.sh:3204`), which stops at the first state that holds the branch. It is not `pr-list` and the plan does not name it. Leave it alone.

### The traps a naive implementation walks into

**The existing test stub models `bb` 1.0.0, not 1.9.0.** `makeStrictBbStub` (`host.test.mjs:87`) overwrites `state` on each `--state`, so it keeps the last one. A one-call implementation tested against it returns only the declined rows and still exits 0. Extend the stub, or add a sibling stub, that honours repeated `--state`, applies a 50-row cap across the union sorted by `updated_on`, and answers `--help` with the real `May be repeated` line. The current stub answers `--help` with `bb pr list help`, so every existing test keeps the per-state path. That is correct; leave it.

**A small fixture certifies anything.** Under 50 rows, one call and three calls return the same payload whatever the cap does. The plan requires a fixture of **more than 50 PRs, merge-heavy** (for example 60 MERGED, 3 OPEN, 2 DECLINED, with the open and declined ones older than the 50th merged). Against it, assert whatever the chosen answer promises: an identical payload for option 2, or the stated trade with its report for option 1.

**One truncation check over a union cannot name a state.** `pr_list_report_truncation` runs per state inside `pr_list_states` (`:1002-1003`). On the one-call path it runs once. It must still fire on a full page and must not name a single state as the short one. Name the union (`open,merged,declined`) instead.

### Rules carried over

- **Absent is not false.** A PR missing from a capped page is not a PR that does not exist.
- **Error text travels raw.** The single call goes through `pr_list_call`, so a `429` still reads as a rate limit and exits 5 or 6, never 7.
- **Resolve states before any loop.** `bb_states="$(bb_states_for "$state")" || exit 1` stays outside the loop, for the reason at `:3728-3733`.
- **The three call sites differ only in their jq program.** Make the collapse one change where the command is chosen (`:3735-3741` shows the pattern), not an `if` in each site.

### Done when

The plan's `## Done when` list is the specification. Each of these assertions exists because a naive implementation passes without it:

- **One `bb` invocation, counted in the stub's `calls` file**, for `pr-list --state all` with a repeatable `bb`. This catches a loop that still runs three times.
- **Three invocations when the probe finds no `May be repeated` line.** This catches a probe that always says yes, which would bring back the 1.0.0 failure on craftamap or an old install.
- **The payload over the more-than-50 merge-heavy fixture matches the chosen answer** (identical for option 2, the stated trade plus report for option 1). This catches a cap that crowds out open and declined rows without saying so.
- **`--state all --branch x` still makes one call per state per branch.** This catches the collapse leaking into `bb_branch_sweep`.
- **The partial test at `host.test.mjs:1040` is retired with its reason written down.** The single-state failure test (`:1107`) and the total-outage test (`:1082`) stay and pass.
- **The GitHub `--state all` test (`:1133`) passes unedited.**
- **The PR records `bb --version` (1.9.0 on the dispatch machine), the probe's answer, the fleet-scan finding above, and the new `refreshPrs` figure.**

Plus the repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck`. Do not run `pnpm run test:e2e` locally; CI runs it. Add a changeset for package `plot`, description first, then a comment block with `plan: docs/plans/2026-09-28-a-state-sweep-is-one-request.md` and `bumps:` (`plot: patch`) last. `packages/board` does not change, so no artifact rebuild is needed.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work is moving). Do not run `gh pr create`.
- When the PR exists, record it inside the slice heading in the plan's `## Slices` section: `(Branch: bug/a-state-sweep-is-one-request, PR: #<number>)`. A trailing arrow outside the heading parses as no PR.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh`: the Bitbucket `pr-list` arm (`:3700-3800`), `bb_states_for`'s comment (`:1800-1810`), a new capability probe beside `bb_identify` / `bb_require_json`, and `pr_list_states` only where the one-call path needs it
- `test/reconcile/host.test.mjs`: the Bitbucket multi-state block (`:1030-1145`) and the bb stub helpers (`:66-120`)
- one `.changeset/*.md`

It does not touch `packages/board/src/server/fleet.ts` (report the constant, do not change it), `plot-fleet-scan.sh`, the `pr-state` loop at `:3204`, `bb_branch_sweep` or the GitHub arm.

In flight at dispatch (2026-09-29): `bug/a-cold-bitbucket-board-buys-the-whole-list` (#1050) has a local worktree and no remote ref yet. It edits the same Bitbucket `pr-list` arm and the `--since` block of `host.test.mjs` (`:5173-5315`), so expect a conflict in `plot-host.sh`. Resolve it by keeping both behaviours, not by taking a side. `bug/a-supervisor-says-which-checkout-it-serves` and `bug/a-label-override-reaches-the-unit` are claimed and touch neither file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
