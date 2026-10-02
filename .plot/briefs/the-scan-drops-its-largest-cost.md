## Implementation brief — a-scan-says-where-its-time-goes (wave 2: The scan drops its largest cost)

- **Plan (canonical):** `docs/plans/2026-10-01-a-scan-says-where-its-time-goes.md` on `main`
- **Issue:** #1017
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-scan-drops-its-largest-cost` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

This slice waits on `bug/the-scan-time-is-measured`, which has delivered: its table is in the plan's `## Notes`. Read that table first. It names the cost this slice removes.

### What to build

Remove the per-branch `plot-host.sh pr-state` call at `skills/plot/scripts/plot-fleet-scan.sh:1183` (the plan and the Notes call it `:1167`; the line moved). Slice 1 measured it at 36-39 calls per scan and **54-61% of wall time in all five runs**, from load 15 to load 91. Threshold A of the plan holds (one cost at 30% or more). Threshold B does not rest on the 1768 s median, because that run competed with nine foreign scans. Do not cite it.

**Start from this lead, which slice 1 did not measure and this brief did not run.** `host_pr_state` (`plot-fleet-scan.sh:1135`) calls the host per branch only when `$HOST_STATE_CACHE/.list-complete` is absent. `prefill_pr_states` (`:842`) writes that marker only when both `pr-list` calls are known whole, and its fallback test is `_pr_rows < PR_LIST_LIMIT` with `PR_LIST_LIMIT=1000` (`:667`, `PLOT_PR_LIST_LIMIT`). On 2026-10-02 `gh pr list --state all --limit 3000` returns **1063** PRs on this repository. A `--state all` page capped at 1000 rows is truncated, so the marker is never written, every branch the join does not name falls through to `pr-state`, and the scan pays the N+1 that #216 removed. 36-39 calls is the count of branches with no PR row in the list, which fits.

**Confirm it before you change anything.** Run the scan once from a real checkout with `PLOT_HOST_TRACE` or a `PS4` trace of your choice and check, after the run, whether `.list-complete` and `.list-arrived` exist in `$HOST_STATE_CACHE`, and what `host_err` and `$_pr_rows` held. Three outcomes:

- **`.list-complete` absent because the page hit the limit.** This is the expected case. The fix is to make completeness true or provable at this PR count, not to raise a number that the next 100 PRs outgrow. Read `plot-host.sh pr-list` for what it can state: the Bitbucket arm already prints `pr-list sweep complete` and the scan reads that sentence (`:1087-1095`). Whether the GitHub arm can state completeness, or can page past 1000 for the merged side only, is this slice's design question. Name your answer and the measurement behind it.
- **`.list-complete` absent for another reason** (a failed `open` call, `_v_open` not `ok`, a rate limit). Then the limit is not the cause, and the fix is whatever the trace names.
- **`.list-complete` present and `pr-state` still called.** Then the 36-39 calls come from a different call site than `:1183`. Say so on the PR and fix that site instead.

Whichever it is, the plan's rule holds: **the cost decides the fix.**

### Decisions the plan settles — do not re-derive them

**A host call goes to the rule that already owns its frequency.** The plan adds no second cadence. `a-pr-refresh-reads-the-history-once-a-day` (#1087) owns the board's full PR read. A scan listing is a different call. Your PR names which rule it follows. A fix that makes the scan's own listing complete stays in the scan and its adapter. A fix that moves the scan onto the board's PR store is the "decision reads the index" direction in `CLAUDE.md` and it has its own constraint: the index supplies `MERGED` and never `none`. Do not read `NONE` from a store.

**A decision made in shell moves into `packages/domain/src/rules/`.** If your fix adds a completeness rule or a limit rule, it is a rule, it is reached through a shipped bundle (`docs/shell-and-domain.md`), and the scan asks it. Do not keep a second copy in shell. Shell overhead with no decision in it is fixed in the same function, with no new script.

**The terminal cache cannot help here.** Run 2 (warm) made the same 42 host calls as run 1 (cold). `terminal_learn` (`:1283`) caches `MERGED` and `CLOSED` only, and the estate resolved to 18 open, 17 blocked, 6 wip, 2 claimed and 3 merged. Do not extend the cache to `OPEN` or `NONE`: the cache never answers a state that can still change.

**`FLEET_SCAN_BUDGET_MS` stays at 90 000** (`packages/board/src/server/fleet.ts:1093`). A budget that moves to fit the scan measures nothing. **No new `plot-*.sh` script.** **No plan-parse cache**: the parse is 481 ms and the panel rejected it.

**Not acted on, and not this slice's:** `plan_meta_index_of` (`:2937-2938`) was the largest shell line, 294 s of ~3550 s in the traced run. It is a shell share, not the named cost. Leave it. If you finish early and still want it, report it on #1017 for a person to decide.

**Rules carried over from the scan's own history.** Absent is not false: a missing row in a list that is not known whole is `-`, never `NONE` (the 2026-08-17 outage). `--ask` may only ever restore asking, never suppress it (`PLOT_SCAN_ASK_ALWAYS`). Read the exit code, not the emptiness: a `pr-list` that exits 0 with no rows is not a complete list (`:1051`). A truncated list must never license `NONE`, because that reports a real PR as absent and is worse than the cost removed. Any change you make to completeness must keep all three.

### Done when

The plan's slice-2 item is the specification: **the median board-shaped wall time falls by at least the share slice 1 attributed to the removed cost** (54-61%, so at least about half), **measured the same way at a comparable load**, and **the scan's output is unchanged for the same estate** (`--json` before and after).

Assertions a naive fix passes without:

- **A before/after on one commit pair at comparable load.** Slice 1 measured at load 15-91. A fall measured against a quiet machine proves nothing. Record `uptime` before and after each run, run before and after back to back, and name both loads. The pre-change figure is `pr-state` at 5.5-5.8 s per call at load 15-22, 37-39 calls.
- **The `pr-state` call count, before and after.** The wall share is what the plan asks for. The call count is what proves the mechanism: it must fall to the number of branches the list genuinely cannot answer. A wall improvement with 36 calls left is load, not the fix.
- **A `--json` diff of the same estate**, taken from the same `origin/main` commit with the same cache state. Any difference in a branch's `verdict` or `pr` field is a defect, not a side effect. In particular no branch that read `-` or `open` may read `none`.
- **A test that a list at the limit does not write `.list-complete`.** Fake `plot-host.sh` returns exactly `PR_LIST_LIMIT` rows and the marker must be absent. And one that a list known whole writes it. This is the guard the fix must not weaken.
- **A test that the host is still asked per branch when completeness cannot be established**, so a Bitbucket checkout with `bb pr list` capped at 50 does not read `NONE` for a real PR.

Plus the repo gates: `nvm use` (Node 24), `pnpm install` if `node_modules` is missing, `pnpm test`, `pnpm run test:contracts`, and `pnpm run test:board` if you touch `packages/`. If you add a rule under `packages/domain/`, add its bundle under `skills/plot/scripts/board/` and run `pnpm build:board`. Do not run `test:e2e` locally. A changeset is required, since `skills/plot/scripts/` ships: `'plot': patch`, description first, `bumps:` block last, naming `plot` as patch. Run `./scripts/check-changeset-packages.sh`.

If the measured fix proves to be something this brief did not anticipate, and the plan's Done-when cannot hold, stop and write `PLOT-BLOCKED` with the numbers. Do not defer the slice yourself: a person writes `deferred:`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` to this slice's heading in the plan's `## Slices`: `(Branch: bug/the-scan-drops-its-largest-cost, PR: #<number>)`.
- Post the before/after table on #1017. **Do not close #1017.** A person closes it after reading the numbers.
- The scan reads and never writes the host. Do not change the board's PR store or the scan's cache directories between the before and after runs.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh`, the adapter script it calls for the listing (`plot-host.sh`, `pr-list` only), any new rule under `packages/domain/src/rules/` with its bundle under `skills/plot/scripts/board/`, their tests, the changeset, and the plan's `## Slices` line and `## Notes`. Anything else is out of scope. Do not edit `fleet.ts`: the board's budget and its `--stream` call stay as they are.

Other branches in flight on `plot-fleet-scan.sh` at the time of writing: none known. Check `git branch -r --no-merged origin/main` and `git log origin/main -5 -- skills/plot/scripts/plot-fleet-scan.sh` before you start, because the scan is a hot file (`bug/the-merge-subject-is-one-rule` touched it two days ago). Rebase onto `origin/main` before you take the "after" measurement, so both runs are on one script.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
