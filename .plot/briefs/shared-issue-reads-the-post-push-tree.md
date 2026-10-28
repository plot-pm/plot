## Implementation brief — shared-issue-reads-the-post-push-tree

- **Plan (canonical):** `docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md` on `main`
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Branch:** `bug/shared-issue-reads-the-post-push-tree` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** plot-review on the PR, per `Review required since`

Slice 4 of 5. Slices 1 (`bug/booking-branches-carry-no-upstream`, #2838) and 2
(`bug/the-push-lock-spans-the-booking`, #2860) are already merged to `main`.
This slice is independent of slice 3 (`bug/one-release-job-per-plan`, not yet
started) and slice 5 (depends on slices 2 and 3, merges last). Touch only the
release arm's sibling read — do not touch the lock, the job-refusal logic, or
step 5b.

### What to build

`runRelease` in `packages/board/src/server/entry/deliver.ts` reads sibling
plans — to decide whether a shared tracker issue stays open or closes — from
`ctx.planStore`, which is `planStoreShell({ repoRoot, scriptDir })` rooted at
the **main checkout** (`deliver.ts:645`, `repoRoot` from `run`'s own
`refsGit(...).repoRoot()` call). That read happens at `deliver.ts:908`,
**after** `cleanup()` has already removed the booking worktree (`tmpwt`) at
`deliver.ts:898`. The booking worktree is where this release's own commit was
just pushed to `origin/main`; the main checkout's working tree is a separate,
unrelated clone of the same repo that this push never touches.

Concretely: two plans, A and B, both name issue #X and are both unreleased.
Release A runs first in a booking worktree, pushes a commit closing out A's
own record, then reads siblings — but reads them from the main checkout,
which still shows B as the only other opener and does not reflect A's own
just-landed state either (not that it needs to; A excludes itself by path).
The actual defect: when B's release runs concurrently or shortly after and
its booking worktree is cut from `origin/main` post-A, B's sibling read of
"is A still unfinished" should say no — but if it reads the **main
checkout** instead of its own booking tree (or A's), it reads a snapshot that
may predate A's push landing, because nothing fetches or updates the main
checkout as part of any release. Two sequential releases in one sweep can
each find the other "still open" and both skip the close, leaving #X open
forever — the exact failure named in the plan's Motivation and Changelog
("When two plans in one release sweep name the same issue, the last plan to
release closes the issue" must hold, and today nothing makes it hold).

Fix: read the sibling lines from the **booking worktree** (`tmpwt`), which
was freshly cut from `origin/${main}` via `ctx.trees.addBranch` at
`deliver.ts:840` — i.e. after any prior release in the sweep already pushed —
and do the read **before** `cleanup()` runs, not after. Moving the read
earlier is necessary: `cleanup()` (`deliver.ts:898`, `removeWithBranch`)
deletes `tmpwt` and its branch, so there is nothing left at that path once
the read happens today.

### Settled decisions — do not re-derive

- **Read `tmpwt`, not `ctx.repoRoot`.** The booking worktree holds
  `origin/${main}` as of the moment *this* release's booking branch was cut —
  which is after every push that landed before it in a sweep. The main
  checkout holds whatever a human or another process last fetched into it,
  which is unrelated to release ordering and can be arbitrarily stale. Only
  the booking worktree's tree has the ordering guarantee the shared-issue
  rule needs.
- **Move the read before `cleanup()`, not just change its root.** `cleanup()`
  runs at `deliver.ts:898`, three lines before the comment introducing the
  `planDirCfg`/`siblingLinesOf` block at `deliver.ts:902-908`. Reordering
  without changing the root fixes nothing (the path still gets removed out
  from under a same-root read); changing the root without reordering fixes
  nothing either (there is no `tmpwt` left to read). Both parts are the fix.
- **`siblingLinesOf` takes a `PlanStore` and a `planDir` as parameters
  already** (`deliver.ts:191-204`) — it does not hardcode `ctx.planStore`.
  Construct a `planStoreShell({ repoRoot: tmpwt, scriptDir: ctx.scriptDir })`
  (same constructor `deliver.ts:645` already uses, rooted differently) and
  pass that in, rather than widening the function's own contract.
- **`scripts.planMeta(files)` takes explicit file paths** (`scripts.ts:127`)
  — it has no implicit root of its own. The paths `siblingLinesOf` builds via
  `listDir(planDir)` must themselves resolve against `tmpwt`'s plan
  directory, which falls out for free once the `PlanStore` passed in is
  rooted at `tmpwt`: `planStoreShell` resolves `listDir`/`readText` against
  its own `repoRoot`, but the file paths it returns are repository-relative
  strings — confirm `scripts.planMeta` is invoked with paths that are valid
  relative to `tmpwt` (i.e. launched with `cwd: tmpwt`, or made absolute
  against `tmpwt` before the call) rather than resolved against
  `ctx.repoRoot`'s `scriptDir`-relative assumptions. Read `scriptsShell`'s own
  construction (`scripts.ts:relevant`, `scriptPath`) before assuming either
  behaviour — do not guess the cwd a spawned script inherits.
- **The excluded-self path (`rel`) is still correct as a main-checkout-relative
  path.** `siblingLinesOf`'s `excludeFile` filter compares normalized paths
  (`deliver.ts:198`); `rel` is already relative to the repo root and resolves
  identically inside `tmpwt`, since both trees share the same relative layout.
  No change needed there.
- **This is a different defect from #2578 (merged, `bug/shared-issue-close-reads-every-sibling`).** That slice fixed *which plans* count as siblings (Active + Delivered, not Active-only) and threaded one skip list to both the Jira write and the close. This slice fixes *which tree* the siblings are read from. Both are real and independent; do not re-litigate #2578's fix or widen this slice into it. `unfinishedIssuesOf`, `parsePlanSiblingLine`, and the skip-list plumbing (`deliver.ts:902-925`) are already correct post-#2578 — leave them as they are, only change where the bytes they parse come from.
- **Rules carried over unchanged:** arrow functions for every function you write in `packages/domain`; TSDoc states behaviour, not history; the layering rule (controller calls domain, never spawns; `plot-*.sh` reached only through the `scripts`/`planStore` port); absent is not false (an unreadable sibling set stays `'unreadable'`, never an empty set — #2578's own fix, now load-bearing for this one too: don't let a path-change regress it to empty on a read failure inside `tmpwt`).

### Done when

The plan's `## Done when`-equivalent for this slice is the Slices-section line
plus Changelog bullet: "When two plans in one release sweep name the same
issue, the last plan to release closes the issue." The Tests section names
the assertion directly (plan `### Tests`, Slice 4): *"a board unit test on the
release arm with fixture ports: two plans name one issue, both release in
sequence while the main checkout does not move, and the second release
closes the issue."*

Write that test first (it fails today), then make it pass. The assertion
that matters is specifically **"while the main checkout does not move"** —
a test that also updates the main checkout between the two releases would
pass even with today's bug, because it would mask the stale-tree defect this
slice targets. Keep the main checkout fixture frozen at its initial fetch and
only advance `origin/main` (or whatever the fixture's bare remote is) between
the two release calls.

Also assert:
- A single release (no concurrent sibling) is unaffected — same outcome as
  before, read from `tmpwt` instead of the main checkout, when both happen to
  agree.
- An unreadable sibling set (failed `planMeta`, or `tmpwt` listing failure)
  still reports `'unreadable'` and skips the close — not empty, not a crash.

Plus: a changeset (`plot` or `@plot-pm/board` package, description first,
`bumps:` block last, optional `plan:` line naming this plan); no built bundle
in the diff (`scripts/check-no-bundle-diff.sh`). Before each push, run
`node skills/plot/scripts/board/plot-local-checks.mjs` from the repo root and
run what it prints. The suites in the `CI suites` config key run in CI on
every PR; a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shipped shell under
`skills/` grows past its merge base — this slice touches no `.sh` file, so it
should not trip, but re-check if the fix ends up touching
`plot-plan-meta.sh` or a related script.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`).
Append `→ #<number>` to this branch's line in the plan's `## Slices` section
under the `### Shared issues` heading. Push the first real commit as soon as
it exists.

### Scope guard

This branch owns the release arm's sibling-read region in
`packages/board/src/server/entry/deliver.ts` (roughly `:835-925`: the booking
worktree, `cleanup()` ordering, `siblingLinesOf` call site) and its tests. It
does not touch: the push-lock span (slice 2, already merged), the
one-job-per-plan refusal (slice 3, separate PR), step 5b's outcome reads
(slice 5, merges last and depends on this), or `unfinishedIssuesOf` /
`parsePlanSiblingLine` / the skip-list plumbing in
`packages/domain/src/rules/issue-status.ts` (already correct, from #2578 —
read, do not rewrite). If you find something the plan did not anticipate,
report it rather than improvising outside scope.
