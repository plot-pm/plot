## Implementation brief — the-pr-index-keeps-checks-pending

- **Plan (canonical):** `docs/plans/2026-10-24-the-pr-index-keeps-checks-pending.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2570 merged
- **Branch:** `bug/the-pr-index-keeps-checks-pending` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, no wave ordering.

### What to build

PR #2550 had four green checks at 13:37:20Z. At 14:08:29Z the PR index (`.git/.plot/state/index/github.json`, `complete: true`) still held `checks: "pending"` for it, with `updatedAt` 13:19:13Z and the last whole refresh 21 hours old. The row stayed under *Waiting on a machine* and `awaitsMarkReady` never fired for a green draft (issue #2560).

The issue blames the delta keyed on `updatedAt`. **That is incomplete:** `packages/fleet/src/shared/pr-refresh.ts` (the block after the primary `pr-list` call, near `:1577`) already re-asks stored `OPEN` + `pending` rows on every delta (#1277, `pendingOpenPrNumbers`). So the work starts with a reproduction, not a fix.

### Decisions the plan settles — do not re-derive them

**Reproduce first, in a test over `refreshPrs` with a held store and no I/O.** Find which of four causes holds before changing code:

1. The re-ask never fires for this row (the stored row is not matched by `pendingOpenPrNumbers`, or the `pr-list --rich --state open` answer is dropped).
2. The re-ask fires and the host answers `pending` while `gh pr checks` answers `pass` (a different checks source, or `checksSha` bound to an older head).
3. The bound is spent: `entry.prPendingReaskStreak` reached `PR_PENDING_REASK_LIMIT` (5), and the slow path (`PR_PENDING_REASK_SLOW_MS`, 300 s, only while the head is younger than `Checks wait`) stopped the asks.
4. The delta does not run (cadence, backoff, or no fleetd).

The streak and `prReaskAt` live in memory on the refresh entry. A cause that depends on process lifetime needs a test that holds that state, not a fresh entry.

**Expected behaviour stays as the issue states:** a row whose checks read `pending` is re-asked on the incremental refresh, whatever its `updatedAt`, until its checks settle. The plan lists two open questions (slower cadence past `Checks wait` versus a whole-refresh backstop; forcing a whole refresh for a long-pending row). Answer them from the finding and record the answer in the plan.

**Rules carried over unchanged:**

- Only `OPEN` rows are re-asked; `MERGED`/`CLOSED` are terminal.
- The index holds bought answers, never verdicts, and has one writer: `pr-refresh.ts` is the only caller of `foldPrIndex`.
- A refusal or partial answer from the re-ask is no answer: keep the stored rows as they were.
- The index never says no: a missing row is not `pr: 'none'`.

### Done when

The plan has no `## Done when` section; the specification is the Changelog line and Motivation: a green PR whose `updatedAt` did not move settles to `checks: pass` on the next incremental refresh and shows under *Waiting on you* with "mark ready".

Lift these assertions, because a naive fix passes without them:

- A regression test built from the measured shape (row `pending`, `updatedAt` unchanged, host answering `pass`) that fails on `main` before the fix. Without it the test may pass for the wrong reason.
- The bound still holds for a PR whose checks never run: the fix must not re-ask a stuck row on every delta forever.

Plus the repo gates: a changeset for `plot` (description first, `bumps:` block last) and the board artifact is not committed. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. Do not run `test:e2e` locally. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` requires an equal removal in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to the branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/fleet/src/shared/pr-refresh.ts`, its tests, and `packages/domain` rules it calls (`pendingOpenPrNumbers`). Other branches in flight on the PR index: `feature/a-merged-pending-check-is-asked-again`, `feature/one-pr-reader-per-machine-and`, `idea/read-merged-prs-from-the-merge` — check their diffs for `pr-refresh.ts` overlap before editing the same block.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
