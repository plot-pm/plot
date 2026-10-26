# One PR reader per machine and host account, with a shared, jittered budget

> The host rate limit belongs to the account and repository, but Plot reads PRs once per board and once per session. Many readers on one machine list PRs on their own intervals, so bursts trip HTTP 429 while the budget record shows little spent.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Started:** 2026-10-23, Jan Wloka, `feature/one-pr-reader-per-machine-and`
- **Started:** 2026-10-26, Jan Wloka, `feature/pr-reader-lock-elects-one-writer`
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2386
- **Rounds:** 2
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- While no fleet runs, one reader process per machine, host account and repository lists PRs and writes the PR index. Every board for that repository reads the index instead of the host, so the number of PR list requests no longer grows with the number of open boards.

<!-- Board impact: the board's PR read path changes. The board reads the PR index while a fleet runs (today) or while an elected PR reader runs (new), and it starts the reader process when no live reader holds the lock. The board writes no index. No plan format, template, helper script or docs/plans layout change. -->

## Motivation

Measured 2026-10-23 on one machine (issue #2386): the board reported **about 44 spenders** on one host account and repository — two boards (ewz-kus-portal on :7778, websmith on :7777) and about 38 Claude processes. Each lists PRs on its own interval. Bursts return HTTP 429 although the budget is not spent, and the board then backs off about 14 minutes (`prNextIn=863`).

Existing mechanisms stop short of this case:

- `fleetOwnsPrs` (`packages/board/src/server/fleet.ts:2254`) makes the board read the PR store through `readPrsFromStore` instead of the host. It applies only while a fleet supervisor runs, and the store is per repository.
- `plot-budget.sh` keeps one record per `(connector, account, bucket)` and counts spenders. It measures the spend; it does not schedule it.
- [One account has one budget](2026-09-01-one-account-has-one-budget.md) (Released) made the cadence stretch with the number of spenders. It does not remove the spenders, and it adds no jitter between them.

## Design

### Approach

Four proposals came from the issue. This plan schedules proposal 1: one PR reader per `(backend, account, repo)` per machine. Proposals 2 (one request budget per account, spread across repositories with jitter), 3 (event-driven refresh on `git fetch` or board-open) and 4 (conditional requests with `If-None-Match`) stay unscheduled. The plan records no decision against them.

The PR index has one writer path. `refreshPrs` (`packages/fleet/src/shared/pr-refresh.ts:1360`) folds the host's answer through `writePrStore` (`pr-refresh.ts:1324`), the only caller of `foldPrIndex` (`pr-refresh.ts:1333`). Today only fleetd reaches it with the real store: `fleetPrs` (`packages/fleet/src/shared/fleet-clock.ts:166`) gets `store: prIndexFile({ cwd: repoRoot })` at `packages/fleet/src/server/entry/registryd-main.ts:2204`. Without a fleet, the board calls `refreshPrs` with an in-memory overlay (`packages/board/src/server/fleet.ts:2340`), so every board asks the host on its own.

The elected reader is a small dedicated entry, `packages/fleet/src/server/entry/pr-reader.ts`, bundled as `plot-pr-reader.mjs` beside the other fleet entries in `packages/fleet/build.mjs`. It builds the same `PrWorld` as `registryd-main.ts:2200-2208` and runs `fleetPrs` on the fleet clock's PR beat. It runs no supervision tick, no scan, no issue read and no automatic writes. A reader-only fleetd is not used: fleetd's scan clock also runs `fleetAutoWrites` (`registryd-main.ts:2312`), and a PR reader must not dispatch or deliver.

The election keeps one writer at a time:

- The reader takes the lock through `ReaderLock.elect` before every pass. It folds into the real store only on `elected`. On `held` or `failed` it writes nothing and exits.
- fleetd's PR pass takes the same lock before it folds. On `held` it skips the pass. The reader exits at its next pass when the fleet bridge is fresh (`bridgeIsFresh`, `packages/domain/src/rules/scan-owner.ts:52`), and it releases the lock. fleetd then elects on its next PR beat.
- The reader takes `--while-pid <pid>` and exits when that process is gone. It releases the lock on every exit.

The board stays a reader. `fleetOwnsPrs` (`fleet.ts:2254`) becomes true while a fleet owns the scan (`fleetOwnsScan`, `scan-owner.ts:37`) **or** while the lock names a live holder for this key. Then `maybeRefreshPrs` (`fleet.ts:2328`) serves `readPrsFromStore` (`fleet.ts:2264`) and asks the host nothing for PRs. The board reads the lock with `ReaderLock.holder` and `electReader`; it never calls `elect`. When the verdict is `elect` (no holder, or a stale holder), the board starts `plot-pr-reader.mjs --while-pid <board pid>` through the existing `Detached` port (`packages/domain/src/ports/detached.ts`, adapter `adapters/detached/detached-node.ts`) and serves that tick from the overlay path. When the verdict is `unknown`, the board serves the overlay path and starts nothing.

A follower detects a dead reader through `readerIsStale`: a dead pid, a live pid whose start time differs from the claim's `startedAt`, or a claim older than `READER_STALE_MS` (10 minutes). A process-table read that cannot answer keeps the claim. A follower that finds a stale holder starts a new reader and never writes the index itself.

Two defects in the #2436 adapter are fixed before reuse:

- A takeover unlinks the owner file and then publishes. Two processes that both judge the claim stale can both unlink and both publish, so a fresh claim can be removed. The takeover renames the owner file to a unique scratch name, compares the moved claim with the one it judged stale, and restores it when they differ.
- The stale check passes `startedAt: null`, so a reused pid keeps a dead reader's lock for 10 minutes. The adapter reads the holder's start time through the process probe.

The lock key is `(backend, account, repo)`. `backend` comes from `resolveBackend` (`pr-refresh.ts:1021`). `account` comes from `spend-rate`'s `budget_account` field, which answers on GitHub and Bitbucket without a host request. `repo` is the repository's common git dir, which is where the PR index lives. #2436 used `path.basename(repoRoot)`, which gives two repositories with one directory name one lock.

`one-pr-index-writer.test.ts` and `one-issue-index-writer.test.ts` stay unchanged and green:

- `foldPrIndex` stays in the domain and the fleet package (`one-pr-index-writer.test.ts:78`).
- No board source writes through `prIndexFile` or `prStoreFor` or hands one to `refreshPrs` (`one-pr-index-writer.test.ts:87`). The board hands the reader a script path and a pid, not a store.
- Only `registryd-main.ts` hands the real issue store to an issue world (`one-issue-index-writer.test.ts:119`). The reader passes `issueGate: issueGateOf(issueIndexFile(...))` (`packages/fleet/src/shared/issue-refresh.ts:676`) and binds no `issueStore` name.

Constraints from `CLAUDE.md`:

- *A Decision Reads The Index*: the index keeps one writer path, and only one process at a time takes it per key. A follower never treats a missing row as `pr: none`.
- The layering rule: the domain owns the election rule (`reader-election.ts`) and the port (`reader-lock.ts`); the file lock is an adapter (`reader-lock-file.ts`). The board starts the reader through the `Detached` port.
- The cache is the existing PR index at `.plot/state/index` under the common git dir. The plan adds no cache location.

### Open Questions

- [ ] Does Bitbucket return ETags for the PR listing? Measure before proposal 4 is scheduled.
- [ ] Where does the reader publish its last PR error? `readPrsFromStore` reads `prError` from the fleet bridge (`fleet.ts:2280`), and no bridge exists while only the reader runs. A candidate is a `prError` field on the reader's claim.
- [ ] Do the Claude sessions (about 38 of the 44 measured spenders) list PRs through a path this plan changes? This plan changes the board's read path only. Measure which session reads reach the host before a session slice is scheduled.
- [ ] Should the reader outlive the board that started it while another board for the same repository runs? The current design restarts it from the next board's PR tick, and that board reads the host through its overlay for one tick.
- Answered: a reader elects itself through `reader-election.ts`'s pure rule over a lock published through a scratch write and `link()`, not through `mkdir` as a lock. An unreadable lock gives `unknown`, and the board then reads through its own overlay rather than blocking.
- Answered: the cache extends the existing PR index store; it does not replace it.
- Answered: the same design applies to both connectors. The account segment reads from `spend-rate`'s `budget_account` field rather than `Host.account()`, because `Host.account()` refuses on Bitbucket.

## Slices

### Shared reader

- `feature/one-pr-reader-per-machine-and` → #2436 — one locked reader per host account and repository, with a cache every other process reads <!-- deferred: 2026-10-25, PR #2436 closed unmerged at the operator's request. The shared reader writes the real PR index from the board, and one-pr-index-writer.test.ts refuses any board-side write to that index (commit a1355bfec). The branch keeps 4 commits of work. -->

### Reader lock

- `feature/pr-reader-lock-elects-one-writer` — `reader-election.ts`, the `reader-lock.ts` port and the `reader-lock-file.ts` adapter from #2436, with a takeover that cannot remove a fresh claim, a stale check that reads the holder's start time, and a key whose repo segment is the common git dir; no caller yet

### Reader process

- `feature/pr-reader-process-writes-the-index` — `plot-pr-reader.mjs` runs `fleetPrs` behind the lock and exits with its starting board or when a fleet runs; fleetd's PR pass takes the same lock; the board reads the index while a live reader holds the lock and starts the reader through the `Detached` port; both index-writer tests stay unchanged

## Notes

- Source: issue #2386, https://github.com/plot-pm/plot/issues/2386.
- State: Approved since 2026-10-23. The first slice (#2436) is deferred because it wrote the PR index from the board. This design replaces it with the two slices above.
