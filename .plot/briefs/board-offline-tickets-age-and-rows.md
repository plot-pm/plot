## Implementation brief — board-status-banner-offline-tickets-and (wave: Offline tickets)

- **Plan (canonical):** [docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md](../../docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Branch:** `bug/board-offline-tickets-age-and-rows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review GitHub App runs on the PR; see plan Notes)

This branch waits on `bug/board-status-banner-states` — already merged as PR #2550 — so nothing blocks starting this slice. `bug/board-build-joins-honour-opts`, `bug/board-estate-runs-once-per-head` and `bug/board-client-fetch-bound-and-click` touch disjoint files and may run concurrently; only `fleet.ts` is shared with the now-merged PR status slice, and that merge already landed.

### What to build

Issue #2477's findings #2384 and #2372 show the offline ticket fallback reporting an age or a row set that does not match what actually rendered:

- **`packages/board/src/server/fleet.ts:2141`** (`offlineIssueRowsInto`) sets `entry.issueAt` from the index file's `at` **before** calling `ticketPlansOf`. If the plan read then fails, the function returns early (line ~2144, the `plans === null` branch) having already set an age — so the board shows a "last updated N ago" note sitting above whatever `entry.issues` was left as (unchanged from before this call, per the doc comment's promise). Move the `entry.issueAt` assignment so it only happens once the function has rows it actually renders into `entry.issues`.
- **`packages/board/src/server/fleet.ts:1954`** (top of `refreshIssues`): `entry.issueAt = null` is cleared unconditionally on every call, but a later failed poll that falls through to `offlineIssueRowsInto` and gets `{ from: 'none' }` or `{ from: 'memory' }` leaves `issueAt` at `null` while **`entry.issues` itself is not cleared** — it was already carrying the earlier index-sourced rows from a previous failed poll (`entry.issues` is only ever reassigned inside `offlineIssueRowsInto`'s `from === 'index'` branch, or by an answered read). The expected behaviour in the issue is explicit: *"a failed poll clears the age and the rows together."* Today a second consecutive failure with no index match can show stale rows with no age, or from a source that no longer matches. Clear `entry.issues` (and `entry.waiting`, which is already nulled) alongside `entry.issueAt` whenever the fallback does not land on `from: 'index'`.
- **`packages/domain/src/rules/issue-offline-fallback.ts:43`**: `offlineIssueRows` returns `at: index.at ?? ''` — the `''` sentinel for "no `at`" and `ownSource: string` for the source are both implicit. Give the missing age an explicit shape (e.g. `at: string | null`, returning `null` instead of `''`) and type `ownSource` as the two-value union it actually carries (`'tracker' | 'git-host'` — see the exported `OfflineIssueReading.ownSource` and its one caller, `offlineIssueRowsInto`, which already receives `ownSource: 'tracker' | 'git-host'`). Update the one call site that consumes `.at` (`fleet.ts:2142`, `Date.parse(decision.at)`) for the new `null` case — `Date.parse(null)` does not parse to `NaN` the way `Date.parse('')` does in every engine, so don't rely on the existing `Number.isNaN` guard without checking this.

### Decisions this plan already settled — do not re-derive them

**Memory beats the file, and that is not this slice's bug.** `offlineIssueRows` (the pure domain rule) is correct today: it already prefers `memoryRows` over the index file, and its `OfflineIssueRows` union (`'memory' | 'index' | 'none'`) is the right shape. The defect is entirely in the **caller**, `offlineIssueRowsInto` — it computes the right `OfflineIssueRows` value but then writes `entry.issueAt` on a path (`plans === null`) that doesn't correspond to rows landing in `entry.issues`. Don't restructure `offlineIssueRows` itself beyond the `at`/`ownSource` typing fix above.

**`readIssuesFromStore` is a different function and is not in scope.** It's the no-fleet board's own path for serving the inbox entirely from `issues.json` (see `fleet.ts`, function below `offlineIssueRowsInto`) and has its own, already-correct handling of missing/unreadable/mismatched-source index states. The two functions read the same file through the same `issueStoreFor` but serve different callers (`refreshIssues` on a failed live read vs. a fleet-less board). Confusing them is the easiest way to over-scope this slice.

**`entry.issueAt`'s null-on-every-call behavior at line 1954 is correct and stays.** The existing comment there — *"set again only by `offlineIssueRowsInto`... every other outcome has no file age to show"* — is accurate for the `answered`, `memory-served`, `unsupported`, `nobody` outcomes. The bug is narrower: within the `failed` outcome specifically, `offlineIssueRowsInto`'s own three-way branch (`index` / `memory` / `none`) needs to also govern `entry.issues`, not just `entry.issueAt`.

### Doc and comment corrections (same lines as the code fix, per the plan's slicing rule)

- **`CLAUDE.md:515`** — currently reads *"The board reads its Waiting on you rows from it \[issues.json\] while a fleet runs and makes no `issue-list` call."* This is now incomplete: `offlineIssueRowsInto` also reads `issues.json` on a **failed live read with no fleet running at all** (that's its entire purpose per #2369, documented at `fleet.ts:2113`). Extend the sentence to cover both the fleet-less `readIssuesFromStore` path and the failed-live-read `offlineIssueRowsInto` path, or split it into two sentences — whichever reads more plainly. Don't touch the rest of the paragraph (the `refreshIssueIndex`/writer claims are still accurate).
- **`packages/board/src/server/fleet.ts:2118`** — the doc comment on `offlineIssueRowsInto` says *"only `entry.issues`, `entry.waiting` and `entry.issueAt` move here"* but the function body never assigns `entry.waiting`. Either make the comment match the code (drop `entry.waiting` from the list — simplest, since the caller already nulls `entry.waiting` before calling this function and that's correct) or, if the `issues`/`issueAt`-clearing fix above makes it natural to also set `entry.waiting` here, update both together. Prefer the comment fix unless the code change above makes `entry.waiting` actually need setting.
- **`packages/board/test/unit/no-fleet-issue-gate.test.ts:225`** area — the test titled *"still asks the host on the next poll"* only asserts `entry.issueNextAt > 0`, which was already true before this fix and proves nothing about retrying. Strengthen it to assert the next poll is **not** a backoff-only gate, or assert `entry.issueAnswer === 'failed'` is what drives the next ask (whatever makes the assertion fail if the retry logic regresses).
- **`packages/domain/test/issue-offline-fallback.test.ts:66`** — the test titled *"shows nothing where the memory is empty but present (an answered empty inbox)"* actually asserts `{ from: 'memory', rows: [] }`, not `'none'` — the title and the assertion disagree. Fix the title to describe what it checks (an empty-but-present memory array still wins over the index, per "memory beats the file").

### Done when

The plan's `## Done when` is implicit in its per-slice line; this slice's own line is: *"the issue age, failed-poll clearing and typed fallback, plus the CLAUDE.md and comment corrections (#2384, #2372)."* Concretely:

- `offlineIssueRowsInto` sets `entry.issueAt` only on the branch that also sets `entry.issues` — add a test exercising the `plans === null` early return and asserting `entry.issueAt` stays `null` (this is the regression test for #2384's MEDIUM finding; it did not exist before).
- A second consecutive failed poll that does not match `from: 'index'` clears both `entry.issueAt` and `entry.issues` — add a test for two sequential `refreshIssues` calls: first populates `entry.issues` from the index, second fails with no index match and expects `entry.issues` to be `[]`/empty, not the stale rows from the first call.
- `offlineIssueRows`'s `at` return type no longer uses `''` as a sentinel, and `ownSource` is typed as the two-value union — the existing test at `issue-offline-fallback.test.ts:66` area (`"falls back to an empty age where the index carries rows but no `at`"`) needs its expected value updated from `at: ''` to `at: null`.
- `CLAUDE.md:515`, `fleet.ts:2118`'s doc comment, and the two misnamed test titles above are corrected.

Plus the repo's standing gates: no board bundle committed in the diff (`scripts/check-no-bundle-diff.sh`), and a changeset if this ships as part of a release train (check `## Plot Config` → `Plan PRs: required` already covers the PR gate itself).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related `packages/domain` vitest suite and `tsc --noEmit` for domain changes, and the related `packages/board` vitest suite plus `pnpm run typecheck` for board changes, since this slice touches both packages. The suites under `## Plot Config`'s `CI suites` key (`test:e2e`, `test:contracts`, `test:board`, domain coverage, reconcile tests) run in CI on the PR — do not run them locally as a matter of course (`test:e2e` especially: it dispatches real workers and is CI's gate, not a local one). A failure there comes back as a correction.

Name the shell gate too: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice touches no `.sh` file, so it should not trip — but if any helper script ends up touched, growth must be paid for in the same change.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR through the controller, never `gh pr create`:
  ```bash
  ../plot/scripts/plot-open-pr.sh          # current branch, ready
  ../plot/scripts/plot-open-pr.sh --draft  # while still moving
  ```
  It reads the plan, titles the PR from this slice's wave heading, and includes the plan and this brief in the body.
- When the PR is created, append `→ #<number>` to this branch's line under `### Offline tickets` in the plan's `## Slices` section, and commit that edit to the plan (on `main`, since this plan's `Impl` is `own-branches`).

### Scope guard

This branch owns:

- `packages/board/src/server/fleet.ts` — the `offlineIssueRowsInto` and `refreshIssues` edits only; do not touch the PR-status code paths in this file (already fixed and merged in #2550).
- `packages/domain/src/rules/issue-offline-fallback.ts`
- `packages/domain/test/issue-offline-fallback.test.ts`
- `packages/board/test/unit/no-fleet-issue-gate.test.ts` — title/assertion fix only
- `CLAUDE.md` — line 515's paragraph only

Other branches in this plan's fan-out, verified at dispatch:

- `bug/board-status-banner-states` (#2550) — **already merged.** Its changes to `packages/domain/src/rules/pr-status.ts` and `host-notes.ts` are on `main`; this branch does not need to rebase for them specially since it branches from `main` fresh.
- `bug/board-build-joins-honour-opts` — owns `packages/board/src/server/controllers/fleet-state.ts` and its coalescing test. No file overlap with this slice.
- `bug/board-estate-runs-once-per-head` — owns `packages/board/src/server/board.ts` and `packages/domain/src/adapters/trees/trees-git.ts`. No file overlap with this slice.
- `bug/board-client-fetch-bound-and-click` — owns `packages/board/src/app/App.tsx` and `packages/board/test/integration/plan-link-click.browser.test.ts`. No file overlap with this slice.

If something in `fleet.ts` turns out entangled with the PR-status code beyond what's described above, or a finding doesn't match what's on `main` (line numbers in the issue are pinned to `84b1638e4` and can have shifted), report it rather than improvising outside scope.
