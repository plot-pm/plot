# An idle board and fleetd spend about 610 GitHub GraphQL requests per hour

> With no desk, worker loop or Claude session running, one board and one fleetd on the plot repository spent 4,966 GitHub requests in 8 hours. fleetd's nothing-done step spends most of them: it asks the host for the PR state of every leftover plan-named worktree on every tick, also where the answer cannot change its verdict, and no counter reports the call. This plan asks only where the answer decides, answers from the PR index where it can, and counts the call.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2715
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd asks the host for a leftover desk's PR state only when the answer decides the desk's verdict, and the tick line's `mine=` counts that call.

<!-- Board impact: none. The board makes no GraphQL call while fleetd owns PRs (measured 2026-10-26), and the fix changes no field the board reads. -->

## Motivation

`~/.plot/state/budget.tsv` on 2026-10-26, measured over 24 hours:

| Connector | Account | Bucket | Requests in 24 h |
|---|---|---|---|
| github | jwloka | graphql | 16,456 |
| github | jwloka | core | 2,235 |

From 00:00 to 07:59 no desk, worker loop or Claude session ran. The running processes were one board (`board-server.mjs`, port 7777) and one fleetd, both on the plot repository.

### Measured spend

- `budget.tsv.1`, 00:00–07:59: 4,942 `graphql` lines (618 per hour, 601–660 in each hour) and 24 `core` lines. *Measured.*
- The lines have two shapes. Bursts: 326 bursts in 8 hours, period median 89.9 s, mean 11.6 lines per burst, calls about 1.2 s apart and serial, 472 lines per hour (77 %). Singletons and pairs: 146 lines per hour, with about 200 pairs 11–12 s apart. *Measured.*
- A `ps` sample every 0.25 s for 200 s (18:40–18:43) shows fleetd (pid 8692) as the parent of every GraphQL call: `pr-list --state merged --limit 500` once per tick, one `pr-state <branch>` for each of 2 branches per tick, and the scan pair `pr-list --state open --limit 3000 --rich` and `pr-list --state all --limit 3000`. The board (pid 23604) spawned only `gh run list` (core) and `plot-host.sh backend`, and no GraphQL call. *Measured.*
- In the same window the `fleetd.log` ticks show `unclaimed=8|10`, `cost≈15s` and `mine=60/hr`. *Measured.*
- At the sample, 2 plan-named worktrees had no manifest (`desk-4606124b` on `bug/reconcile-scan-sections-22-24`, `free-b71b8ae4` on `feature/one-pr-reader-per-machine-and`), and the sample shows exactly 2 `pr-state` calls per tick. Both desks hold the ending `blocked`. *Measured.*

### Callers

| Caller | Operation | Cadence | Lines per hour (idle) | Basis |
|---|---|---|---|---|
| fleetd nothing-done step | `pr-state` per plan-named worktree with no manifest | every tick (≈ 90 s), serial, no memo, not counted | ~430 (about 10 desks × 40 ticks) | burst shape measured; attribution inferred |
| fleetd tick `mergedBranches` (`registryd-main.ts:791`) | `pr-list --state merged --limit 500` | 1 per tick | ~40 lines, about 200 requests | `ps` measured; page count inferred |
| fleetd scan listing (`plot-fleet-scan.sh`) | `--rich` open list and `--state all --limit 3000` | about every 2 min | ~50 lines, each `all` call several pages | pairs measured |
| fleetd PR refresh (`pr-refresh.ts`) | `pr-list --rich --since` | 60 s | ≤ 60 | inferred, not in the 200 s sample |
| fleetd issue refresh | `issue-list` | ≥ 120 s | ≤ 30 | inferred |
| board | none while fleetd owns PRs | — | 0 | measured |

The sum is 472 + 146 = 618 lines per hour, against 610 per hour in the first reading.

### Root cause

The tick loop (`registryd-main.ts:2471`) calls `startNothingDoneReleases` (`registryd-main.ts:1760`), which calls `nothingDoneDecisions` (`registryd.ts:1374`) for every candidate of `nothingDoneCandidateTrees` (`registryd.ts:1262`: not main, not registered, plan-named). `nothingDoneDecisions` asks `prOpen` for every candidate that does not hold a `bound`, `unreadable` or `quiet` ending (`registryd.ts:1397`). The port at `registryd-main.ts:2480` runs `plot-host.sh pr-state`, which is one `gh pr view <branch>` with `statusCheckRollup` (`plot-host.sh:4008`). The call has no memo across ticks.

`endingAction` reads `prOpen` in one row only: ending `nothing-done` and `commitBeyondClaim === 'no'` (`ending-action.ts:347`). The other rows return before it, and the `bound` row that reads `prOpen` through `boundBranchHoldsWork` (`ending-action.ts:199`) never reaches this step. `endingReleaseBranch` (`ending-action.ts:393`) reads `ending`, `refusedAssignment` and `branch`, and not `prOpen`. So for the two measured desks, both `blocked`, every `pr-state` call is spent on an answer the verdict does not read.

The call is also invisible. `spendForTick` reads `tally.calls` at `registryd-main.ts:2422`, before the fresh-agent step (`:2458`) and the nothing-done step (`:2471`) run, and the loop sets `tally.calls = 0` at the top of the next tick (`:2366`). The nothing-done port does not add to `tally` at all. The fresh-agent port does (`registryd-main.ts:1583`, `:1595`), but its calls are cleared before any reading. So `mine=60/hr` reports the merged-list call and nothing after the spend reading.

Secondary: `budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process. A paged `pr-list --limit 500` or `--limit 3000` call spends several GraphQL requests and records one line, so the record under-counts the listings. *Inferred from the page sizes; not measured per page.*

### Related plans

- [2026-10-23-one-pr-reader-per-machine-and](2026-10-23-one-pr-reader-per-machine-and.md) (#2386, Approved) gives the boards of one repository one PR reader. The board makes no GraphQL call while fleetd owns PRs, and the nothing-done step is not a PR reader of the boards, so that plan does not change this rate, and this plan does not depend on it.
- [2026-10-16-fleetd-scan-cost-and-read-cadence](2026-10-16-fleetd-scan-cost-and-read-cadence.md) (Released) bounded the fleet scan's reads. The scan listing in the table above is within that bound.
- [2026-10-01-a-shared-account-names-what-spends-it](2026-10-01-a-shared-account-names-what-spends-it.md) (Released) measured callers by instrumenting a process. This plan used a `ps` sample instead.
- [2026-09-29-a-spend-line-names-its-caller](2026-09-29-a-spend-line-names-its-caller.md) (Rejected) proposed a caller field in the record. The `ps` sample attributed the spend without it.

## Design

### Approach

1. **Ask `prOpen` only where it decides.** In `nothingDoneDecisions`, read `commitBeyondClaim` first, and ask `prOpen` only for a candidate with ending `nothing-done` and `commitBeyondClaim === 'no'`. Every other candidate gets the filler `'unanswerable'`, which takes the same arm as `true` and so points away from `release-claim`. `endingAction` returns the same verdict for every candidate, because no other row reads `prOpen`. A test calls `nothingDoneDecisions` with one candidate per ending and asserts the number of `prOpen` calls: one for `nothing-done` with no commit beyond the claim, zero for every other candidate. A second test asserts that the verdicts equal the verdicts of the current code for the same readings.
2. **Answer `prOpen` from the PR index where it can.** fleetd already reads the index through `prIndexRows` (`registryd-main.ts:843`) at the cost of a file read. A row whose `head` is the branch and whose `state` is `OPEN` answers `true`. That answer gives `leave`, the direction that releases nothing; a stale `OPEN` row delays a release until the next PR refresh corrects the row. The index never answers `false`: a missing row, a `MERGED` row or a `CLOSED` row does not prove that no open PR exists, because the index cannot say *no PR* and knows nothing opened after its `at`. Every such case asks the host as today. The destructive step stays behind its own host read: `gatherReadingsAndRelease` asks `prState` and `prMerged` again before it releases (`release-claim-reader.ts:72`, `:74`).
3. **Count the call in `mine=`.** The nothing-done port adds 1 to `tally` for each host call, as the fresh-agent port does. The loop resets `tally.calls` after the spend reading instead of at the top of the tick, so a reading counts every host call since the previous reading, including the calls of the post-report steps. A test runs one tick with one nothing-done host call and asserts that the next tick line's `mine=` includes it.

### Acceptance

With N leftover plan-named worktrees and no desk running, the GraphQL lines per hour in `budget.tsv` before and after the change. With the 2 measured `blocked` desks, the nothing-done step spends 0 lines per hour after the change, against 2 per tick (about 80 per hour) before. The `mine=` field moves by the same amount as the record.

### Open Questions

- [x] Which process and which operation spend the 610 per hour? — fleetd. The nothing-done step's `pr-state` calls are about 430 of 618 lines per hour with 10 leftover desks (inferred from the burst shape); the rest are fleetd listings. See *Callers*.
- [x] Does the board read the host while fleetd owns the PR index? — No GraphQL call. The `ps` sample shows only `gh run list` (core) and `plot-host.sh backend`.
- [x] Does a caller field in the record answer the question for good? — Not needed here. A `ps` sample of 200 s attributed every GraphQL call to its parent process and operation, so the Rejected plan stays rejected.
- [ ] Is an `OPEN` index row acceptable as the answer `true` for `prOpen`? CLAUDE.md *A Decision Reads The Index* reads only `MERGED` rows. This plan reads an `OPEN` row only in the direction that releases nothing. If the operator declines, slice 2 is dropped and slice 1 still removes the measured spend.
- [ ] What idle rate does the plan accept as done? Proposal: the nothing-done step spends 0 lines per hour for desks whose verdict does not read `prOpen`, and the idle total falls by that step's share.

## Slices

### Ask Only Where It Decides

- `bug/nothing-done-asks-pr-state-only-where-it-decides` — ask `prOpen` only for a `nothing-done` candidate with no commit beyond its claim, count every nothing-done host call in `tally`, and reset `tally` after the spend reading so `mine=` reports it

### Read The Index

- `feature/nothing-done-reads-an-open-pr-from-the-index` — answer `prOpen: true` from an `OPEN` index row for the branch and ask the host on every other row or miss <!-- waits: bug/nothing-done-asks-pr-state-only-where-it-decides -->

## Notes

- Source: issue #2715, https://github.com/plot-pm/plot/issues/2715. The measurement is also posted as a comment there.
- Follow-up, not in this plan: `budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process, so paged `pr-list` calls under-count real GraphQL requests. It concerns every paged listing and the record's format, not the nothing-done step. It needs its own issue.
- Not explained: the burst of 96–236 requests per minute on 2026-10-25 at 20:42–20:50 (peak hour 2,017). The `ps` sample covers 2026-10-26 only. With desks running, the fresh-agent and nothing-done steps see more candidates, which fits a burst, but no sample of that window exists.
- Cited lines verified on `origin/main` at `ea2aa9743`.
