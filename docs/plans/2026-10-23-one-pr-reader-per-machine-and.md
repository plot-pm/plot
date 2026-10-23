# One PR reader per machine and host account, with a shared, jittered budget

> The Bitbucket rate limit belongs to the account, but Plot reads PRs once per board and once per session. Many readers on one machine list PRs on their own intervals, so bursts trip HTTP 429 while the budget record shows little spent.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2386
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- One process per machine and host account lists PRs. Every other board and session reads that process's cache, so the number of PR requests no longer grows with the number of open boards and sessions.

<!-- Board impact: the board's PR read path changes from per-board polling to a shared cache read; no plan format, template, helper script or docs/plans layout change is intended. Confirm in Design. -->

## Motivation

Measured 2026-10-23 on one machine (issue #2386): the board reported **44 spenders** on one Bitbucket account — two boards (ewz-kus-portal on :7778, websmith on :7777) and about 38 Claude processes. Each lists PRs on its own interval. Bursts return HTTP 429 although the budget is not spent, and the board then backs off about 14 minutes (`prNextIn=863`).

Existing mechanisms stop short of this case:

- `fleetOwnsPrs` (`packages/board/src/server/fleet.ts:2234`) makes the board read the PR store through `readPrsFromStore` instead of the host. It applies only while a fleet supervisor runs, and the store is per repository.
- `plot-budget.sh` keeps one record per `(connector, account, bucket)` and counts spenders. It measures the spend; it does not schedule it.
- [One account has one budget](2026-09-01-one-account-has-one-budget.md) (Released) made the cadence stretch with the number of spenders. It does not remove the spenders, and it adds no jitter between them.

## Design

### Approach

Four proposals from the issue. Each is a candidate slice; Design decides which stay.

1. **One reader per machine and host account.** A cache under `~/.cache/plot/<host>/<account>/<repo>`, guarded by a lock. Exactly one process asks the host; every board and session reads the cache. This is the `fleetOwnsPrs` contract without a fleet.
2. **One request budget per account,** spread across repositories, with jitter so boards never fire in the same second. The budget record schedules calls as well as measuring them.
3. **Event-driven refresh** instead of fixed intervals: refresh open PRs when a `git fetch` brings new refs or a reader opens the board. An idle repository asks nothing.
4. **Conditional requests** (`If-None-Match`), only if Bitbucket returns ETags for the PR listing. Measure first.

Constraints from `CLAUDE.md` that Design must settle:

- *A Decision Reads The Index*: the shared cache is an index with one writer; readers never write it and never treat a missing row as `pr: none`.
- The layering rule: the lock and the schedule live in an adapter behind a port, and the domain owns the rule that chooses the reader.
- Whether the cache replaces or extends the existing PR index at `.plot/state/index` under the common git dir. The issue proposes a new location under `~/.cache/plot`.

### Open Questions

- [ ] Does Bitbucket return ETags for the PR listing? Measure before slice 4.
- [ ] How does a reader elect itself, and what happens when the lock holder dies?
- [ ] Does the cache extend the existing PR index or replace it?
- [ ] Which of the four proposals ships first, and which does the 44-spender measurement show to matter most?
- [ ] Does the same design apply to the GitHub connector, or is it Bitbucket only?

## Slices

### Shared reader

- `feature/one-pr-reader-per-machine-and` — one locked reader per host account and repository, with a cache every other process reads

## Notes

- Source: issue #2386, https://github.com/plot-pm/plot/issues/2386. The plan stops at Draft.
