# One PR reader per machine and host account, with a shared, jittered budget

> The host rate limit belongs to the account and repository, but Plot reads PRs once per board and once per session. Many readers on one machine list PRs on their own intervals, so bursts trip HTTP 429 while the budget record shows little spent.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Started:** 2026-10-23, Jan Wloka, `feature/one-pr-reader-per-machine-and`
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2386
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- One process per machine and host account lists PRs. Every other board and session reads that process's cache, so the number of PR requests no longer grows with the number of open boards and sessions.

<!-- Board impact: the board's PR read path changes from per-board polling to a shared cache read; no plan format, template, helper script or docs/plans layout change is intended. Confirm in Design. -->

## Motivation

Measured 2026-10-23 on one machine (issue #2386): the board reported **about 44 spenders** on one host account and repository — two boards (ewz-kus-portal on :7778, websmith on :7777) and about 38 Claude processes. Each lists PRs on its own interval. Bursts return HTTP 429 although the budget is not spent, and the board then backs off about 14 minutes (`prNextIn=863`).

Existing mechanisms stop short of this case:

- `fleetOwnsPrs` (`packages/board/src/server/fleet.ts:2234`) makes the board read the PR store through `readPrsFromStore` instead of the host. It applies only while a fleet supervisor runs, and the store is per repository.
- `plot-budget.sh` keeps one record per `(connector, account, bucket)` and counts spenders. It measures the spend; it does not schedule it.
- [One account has one budget](2026-09-01-one-account-has-one-budget.md) (Released) made the cadence stretch with the number of spenders. It does not remove the spenders, and it adds no jitter between them.

## Design

### Approach

Four proposals came from the issue. **One reader per machine and host account (proposal 1) is the adopted design and has shipped**, in `feature/one-pr-reader-per-machine-and` (PR #2436): exactly one process per `(connector, account, repo)` per machine asks the host, through a locked election; every other board and session on that machine reads what the winner published into the shared PR index store. This is the `fleetOwnsPrs` contract without a fleet.

Proposals 2 (one request budget per account, spread across repositories with jitter), 3 (event-driven refresh on `git fetch` or board-open), and 4 (conditional requests with `If-None-Match`) are not scheduled in this plan's `## Slices` — unscheduled, not rejected; the 44-spender measurement motivated proposal 1 and the plan does not record a decision against the other three.

Constraints from `CLAUDE.md` that Design has settled:

- *A Decision Reads The Index*: the shared cache is an index with one writer; readers never write it and never treat a missing row as `pr: none`. The reader lock's winner folds into the existing PR index store (`prStoreFor`); a follower reads that store and never the host.
- The layering rule: the lock lives in an adapter (`reader-lock-file.ts`) behind a port (`reader-lock.ts`), and the domain owns the election rule (`reader-election.ts`) that chooses the reader.
- The cache extends the existing PR index at `.plot/state/index` under the common git dir — it does not replace it, and it is not a new location under `~/.cache/plot` as the issue first proposed.

### Open Questions

- [ ] Does Bitbucket return ETags for the PR listing? Measure before slice 4 (unscheduled).
- Answered: a reader elects itself through `reader-election.ts`'s pure rule over a lock published via scratch-write then `link()` (the atomic-publish pattern, not mkdir-as-lock, which left a window where a second process could observe a claimed name before its content was written). An unreadable lock falls back to the prior per-process overlay instead of blocking — the dead-holder case degrades rather than hangs.
- Answered: the cache extends the existing PR index store; it does not replace it.
- Answered: proposal 1 shipped first, alone; proposals 2–4 are unscheduled.
- Answered: the same design applies to both connectors. The lock key is `(backend, account, repo)` with `backend` resolved generically (`resolveBackend`), not Bitbucket-specific; the account segment reads from spend-rate's own `budget_account` field rather than `Host.account()`, because the latter refuses outright on Bitbucket, where spend-rate already has a free, local fallback that works on both backends.

## Slices

### Shared reader

- `feature/one-pr-reader-per-machine-and` → #2436 — one locked reader per host account and repository, with a cache every other process reads

## Notes

- Source: issue #2386, https://github.com/plot-pm/plot/issues/2386. The plan stops at Draft.
