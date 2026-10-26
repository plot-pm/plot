# An idle fleetd spends about 610 GitHub GraphQL lines per hour

> With no desk, worker loop or Claude session running, one board and one fleetd on the plot repository recorded 4,966 GitHub lines in 8 hours, and the board recorded no GraphQL line. fleetd's nothing-done step spends about 70 % of the lines and about 35 % of the requests: it asks the host for the PR state of every leftover plan-named worktree on every tick, also where the answer cannot change its verdict, and no counter reports the call. The tick's merged-PR listing spends about 215 requests per hour more. This plan asks the nothing-done question only where the answer decides, counts every call the step makes, and skips the merged listing when MERGED rows of the PR index already settle every branch the queue reads.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2715
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd asks the host for a leftover desk's PR state only for a `nothing-done` desk with no commit beyond its claim, and the tick line's `mine=` counts every host call the nothing-done step and its claim release make.
- fleetd's tick skips the merged-PR listing (`pr-list --state merged --limit 500`) when the PR index holds a MERGED row for every branch an Approved plan names, and the tick line prints `merged-set=index` for that tick.

<!-- Board impact: none. The board makes no GraphQL call while fleetd owns PRs (measured 2026-10-26). The board reads no `merged-set` field and no `mine=` field, and neither slice changes the plan format, the template, a helper script or the docs/plans layout. -->

## Motivation

`~/.plot/state/budget.tsv` on 2026-10-26, measured over 24 hours:

| Connector | Account | Bucket | Lines in 24 h |
|---|---|---|---|
| github | jwloka | graphql | 16,456 |
| github | jwloka | core | 2,235 |

From 00:00 to 07:59 no desk, worker loop or Claude session ran. The running processes were one board (`board-server.mjs`, port 7777) and one fleetd, both on the plot repository.

### Lines and requests

`budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process. A `pr-state` call is one process and one request. A paged `pr-list` call is one line and several requests: the repository holds 1,767 PRs, 1,711 of them merged (one GraphQL `totalCount` query, panel round 1), so at 100 rows per page `--state merged --limit 500` is 5 requests and `--state all --limit 3000` is 18 requests. *Derived.* The record therefore under-counts the listings, and #2717 tracks that. This plan states every rate in lines, and in requests where the two differ.

### Measured spend

- `budget.tsv.1`, 00:00–07:59: 4,942 `graphql` lines (618 per hour, 601–660 in each hour) and 24 `core` lines. *Measured.*
- A burst is a run of `graphql` lines less than 3 s apart, with 3 or more lines. With that definition the night holds 346 bursts, mean 11.1 lines, most often 11, 12 or 13 lines, about 43 per hour, calls about 1.2 s apart and serial: about 480 lines per hour. The rest are singletons and pairs, with about 200 pairs 11–12 s apart. *Measured, panel round 1.*
- A `ps` sample every 0.25 s for 200 s (18:40–18:43) shows fleetd (pid 8692) as the parent of every GraphQL call: `pr-list --state merged --limit 500` once per tick, one `pr-state <branch>` for each of 2 branches per tick, and the scan pair `pr-list --state open --limit 3000 --rich` and `pr-list --state all --limit 3000`. The board (pid 23604) spawned only `gh run list` (core) and `plot-host.sh backend`, and no GraphQL call. *Measured.*
- In the same window the `fleetd.log` ticks show `cost≈15s` and `mine=60/hr`. *Measured.*
- At the sample, 2 plan-named worktrees had no manifest (`desk-4606124b` on `bug/reconcile-scan-sections-22-24`, `free-b71b8ae4` on `feature/one-pr-reader-per-machine-and`), and the sample shows exactly 2 `pr-state` calls per tick. Both desks hold the ending `blocked`. `free-b71b8ae4` has held it since 2026-10-23 17:09, so at about 43 ticks per hour that one desk spent about 3,000 requests on an answer its verdict does not read. *Measured; the request total derived.*
- `.plot/state/endings.jsonl` holds 184 endings: 65 `checks-unanswered`, 31 `unregistered`, 31 `blocked`, 24 `unreadable`, 12 `holding-work`, 12 `corrections-spent`, 5 `unstarted`, 4 `quiet` and 0 `nothing-done`. *Measured, panel round 1.*

### Callers

The tick period is about 84 s (about 43 ticks per hour), not the configured 60 s: the tick itself takes 12–40 s (`cost=` in `fleetd.log`).

| Caller | Operation | Cadence | Lines per hour (idle) | Requests per hour (idle) | Basis |
|---|---|---|---|---|---|
| fleetd nothing-done step | `pr-state` per plan-named worktree with no manifest | every tick, serial, no memo, not counted | ~430 (about 10 desks × 43 ticks) | ~430 | burst shape measured; desk count at night inferred |
| fleetd tick `mergedBranches` (`registryd-main.ts:780`) | `pr-list --state merged --limit 500` | 1 per tick | ~43 | ~215 | `ps` measured; page count derived |
| fleetd scan listing (`plot-fleet-scan.sh:1063`) | `pr-list --state all --limit 3000` | about every 2 min | ~25 | ~450 | pairs measured; page count derived |
| fleetd scan listing (`plot-fleet-scan.sh`) | `pr-list --state open --rich` | about every 2 min | ~25 | ~25 | pairs measured |
| fleetd PR and issue refresh (`pr-refresh.ts`, issue refresh) | `pr-list --rich --since`, `issue-list` | ≥ 60 s | ≤ 90 | ≤ 150 | inferred |
| board | none while fleetd owns PRs | — | 0 | 0 | measured |
| **Total** | | | **~618** | **~1,250** | |

So the nothing-done step is about 70 % of the lines and about 35 % of the requests.

### Root cause

The tick loop (`registryd-main.ts:2471`) calls `startNothingDoneReleases` (`registryd-main.ts:1760`), which calls `nothingDoneDecisions` (`registryd.ts:1374`) for every candidate of `nothingDoneCandidateTrees` (`registryd.ts:1259`: not main, not registered, plan-named). `nothingDoneDecisions` asks `commitBeyondClaim` (`registryd.ts:1396`) and `prOpen` (`registryd.ts:1397`) for every candidate that does not hold a `bound`, `unreadable` or `quiet` ending. The port at `registryd-main.ts:2480` runs `plot-host.sh pr-state`, which is one `gh pr view <branch>` with `statusCheckRollup` (`plot-host.sh:4008`). The call has no memo across ticks.

`endingAction` reads `prOpen` and `commitBeyondClaim` in one row only on this path: ending `nothing-done` (`ending-action.ts:345`), then `commitBeyondClaim` (`:346`), then `prOpen` (`:347`). The other rows return before it. The `bound` row reads both through `boundBranchHoldsWork` (`ending-action.ts:199`), but `nothingDoneDecisions` answers `leave` for a bound ending before it builds readings. `endingReleaseBranch` (`ending-action.ts:393`) reads `ending`, `refusedAssignment` and `branch`, and not `prOpen`. So for the two measured desks, both `blocked`, every `pr-state` call is spent on an answer the verdict does not read. The comment at `registryd.ts:1403` already describes a filler for `commitBeyondClaim` and `prOpen` that the code does not apply; slice 1 makes it true.

The call is also invisible. `spendForTick` reads `tally.calls` at `registryd-main.ts:2422`, before the fresh-agent step (`:2458`) and the nothing-done step (`:2471`) run, and the loop sets `tally.calls = 0` at the top of the next tick (`:2366`). The nothing-done port does not add to `tally` at all. The fresh-agent port does (`registryd-main.ts:1583`, `:1595`), but its calls are cleared before any reading. The claim release (`releaseClaimOf`, `registryd-main.ts:2151`) runs `gatherReadingsAndRelease`, which asks `prState` and `prMerged` (`release-claim-reader.ts:72`, `:74`) and adds nothing to `tally`. So `mine=60/hr` reports the merged-list call and nothing after the spend reading.

`mine=` is `boardSharePerHour(intervalMs, calls)` = (3,600,000 / `intervalMs`) × calls (`cadence.ts:72`), with `intervalMs` = `TICK_INTERVAL_MS` = 60,000 (`registryd.ts:80`). It multiplies a tick's calls by 60, while the real tick period gives about 43 ticks per hour. So `mine=` and the record do not move by the same amount: 2 calls per tick move `mine=` by 120/hr and the record by about 86 lines per hour.

### The merged listing

`mergedBranches` (`registryd-main.ts:780`) asks `pr-list --state merged --limit 500` once per tick and adds 1 to `tally` (`:790`). `readQueue` joins its heads with the MERGED rows of the PR index (`queue-reading.ts:331-333`) through `indexMergedHeads` (`known-pr.ts:66`), which already reads only non-draft MERGED rows. The merged set feeds:

- `planQueue` (`queue.ts:906`): a branch in the set is settled, so it leaves the queue and stops holding later slices; `listingWhole` decides `unmerged` against `unreachable` for a `waits:` prerequisite the set does not name (`queue.ts:855`).
- `landedWithoutListing` (`queue-reading.ts:594`), only when the listing is not whole.
- `subjectProofOf` (`queue-reading.ts:557`) and `claimReadingsOf` (`queue-reading.ts:471`). The second feeds the `orphaned-claims` report, which names a branch and releases nothing (`registryd-main.ts:2687`).
- The `merged-set=` field of the tick line (`registryd.ts:550`).

A branch missing from the set only holds: its slice stays outstanding, a `waits:` prerequisite reads `unmerged`, and a queued slice that a hand-over would pass is asked again per branch through `queuedHasLanded` (`queue-reading.ts:383`). So an index row can stand in for the listing only where it settles the branch, which is the existing rule in CLAUDE.md *A Decision Reads The Index*: a MERGED row is terminal, and the index never says no.

The PR index holds rows only for a store that decodes at `PR_INDEX_VERSION` 5 (`entities/pr-index.ts:12`). The live store at `.plot/state/index/github.json` is `v: 4` (written 2026-10-26 19:06Z by fleetd pid 8692, started 2026-10-17), so `prIndexRows` (`registryd-main.ts:843`) reads no rows until fleetd runs current code. Decoded by hand, that store holds 1,002 rows. Of the 35 non-deferred branches named by plans that are not Delivered or Released, 28 have no MERGED row; of the branches named by Approved plans, 8 have none. *Measured 2026-10-26.*

### Related plans

- [2026-10-23-one-pr-reader-per-machine-and](2026-10-23-one-pr-reader-per-machine-and.md) (#2386, Approved) gives the boards of one repository one PR reader. The board makes no GraphQL call while fleetd owns PRs, and neither step in this plan is a PR reader of the boards, so that plan does not change this rate, and this plan does not depend on it. This plan edits no CLAUDE.md section.
- [2026-10-16-fleetd-scan-cost-and-read-cadence](2026-10-16-fleetd-scan-cost-and-read-cadence.md) (Released) bounded the fleet scan's reads. The scan listing in the table above is within that bound.
- [2026-10-01-a-shared-account-names-what-spends-it](2026-10-01-a-shared-account-names-what-spends-it.md) (Released) measured callers by instrumenting a process. This plan used a `ps` sample instead.
- [2026-09-29-a-spend-line-names-its-caller](2026-09-29-a-spend-line-names-its-caller.md) (Rejected) proposed a caller field in the record. The `ps` sample attributed the spend without it.

## Design

### Approach

1. **Ask only where the answer decides.** In `nothingDoneDecisions`, ask `commitBeyondClaim` only for a candidate with ending `nothing-done`, and ask `prOpen` only for a candidate with ending `nothing-done` and `commitBeyondClaim === 'no'`. Every other candidate gets the filler `'unanswerable'` for both, which takes the same arm as `'yes'` and `true` and so points away from `release-claim`. `endingAction` returns the same verdict for every candidate, because on this path `ending-action.ts:346` and `:347` are the only rows that read the two readings. The comment at `registryd.ts:1403` then describes the code.
2. **Count every call the step makes.** Extract the nothing-done ports at `registryd-main.ts:2475-2490` into a builder that takes `tally`, the shape `freshAgentDeskReads` (`registryd-main.ts:1534`) already has. The builder's `prOpen` port adds 1 to `tally` for each host call. `releaseClaimOf` takes `tally` too and adds 1 for each host call `prReading` makes in `gatherReadingsAndRelease` (`release-claim-reader.ts:72`, `:74`): 2 when the state answers, 1 when it does not. The fresh-agent step shares `releaseClaimOf`, so its releases count too.
3. **Reset the tally where a reading takes it.** The loop sets `tally.calls = 0` directly after the spend reading (`registryd-main.ts:2422`), so the next reading counts the calls of the post-report steps of this tick and the calls of the next tick up to its reading. A tick that takes no reading, because it threw (the `continue` at `registryd-main.ts:2410`) or was incomplete (`report.incomplete !== ''`), makes the next tick reset `tally.calls` to 0 at its top, as the loop does today. So no reading counts the calls of two intervals: the calls of a thrown or incomplete tick, and the post-report calls of the tick before it, are dropped, as today. The `HostTally` TSDoc (`registryd-main.ts:358-364`) and the comment at `:2367` change to state this.
4. **Skip the merged listing where the index settles every branch.** A pure domain rule in `packages/domain/src/rules/known-pr.ts`, beside `indexMergedHeads`, takes the plans, the index rows and whether the store decoded, and answers `index` or `ask`. It answers `index` only when the store decoded at the current version and every non-deferred branch and every `waits:` prerequisite of every Approved plan, and of a Design plan's admitted spike, has a non-draft MERGED row. It answers `ask` in every other case, including a missing, wrong-version or unparseable store. On `index` the tick makes no `pr-list --state merged` call, adds nothing to `tally`, and answers the listing as the index's merged heads with `whole: true`; the tick line prints `merged-set=index`. On `ask` the tick asks the listing as today, and `readQueue` joins the rows as today. This follows the precedent of `plot-reconcile-scan.sh` (#1022): skip the host only when every asked branch has a MERGED row.

   Plans in another phase are not in the rule's set. For them the merged answer decides no hand-over: their slices read `unapproved` or `complete` (`eligible.ts:121`). On an `index` tick, a branch of such a plan that merged after the index's last refresh can stay in the held list as `not-claimable`, and a merged branch whose ref the host kept can appear in the `orphaned-claims` report, until the next `ask` tick. Both are reports, and neither starts, releases or hands over work.

### Tests

- Slice 1: the builder is called with one candidate per ending (`null`, `nothing-done` with `commitBeyondClaim` `'no'`, `'yes'` and `'unanswerable'`, `holding-work` with and without a refused assignment, every fresh-session ending and every outright-person ending). It asserts one `prOpen` host call for `nothing-done` with no commit beyond the claim and zero for every other candidate, one `commitBeyondClaim` call per `nothing-done` candidate and zero for the others, and that `tally` equals the number of host calls. A second test asserts that the verdicts equal the verdicts of the current code for the same readings. The existing `nothing-done-tick.test.ts:179` keeps passing.
- Slice 1: a release through `releaseClaimOf` with a stubbed host adds 2 to `tally`, and 1 when the state does not answer.
- Slice 1: a `run()` test with a stubbed tick runs a complete tick, a tick that throws, and a complete tick, and asserts that the third tick's reading counts only the third tick's own calls.
- Slice 2: the rule answers `index` for a decoded store where every needed branch has a MERGED row; `ask` when one needed branch has no row, when its only row is OPEN, CLOSED or a draft MERGED row, when a `waits:` prerequisite has no row, and when the store is missing, of another version or unparseable. A branch of a Draft, Rejected or Superseded plan without a row does not turn `index` into `ask`.
- Slice 2: `queueWorldForRepo` with a fixture store and a stubbed host makes 0 `prList` calls and adds 0 to `tally` on `index`, and 1 call on `ask`.

### Acceptance

Stated per tick, not in `mine=` units over an hour. `mine=` multiplies a tick's calls by the configured 60 s interval, and the real tick period varies with the tick's cost (12–40 s), so a per-hour comparison of `mine=` with the record cannot pass. Changing the formula to the measured period changes a field every tick line prints and is outside this plan.

- **Slice 1.** With N leftover plan-named worktrees and no manifest, of which M hold the ending `nothing-done` with no commit beyond the claim, the nothing-done step makes M `pr-state` calls per tick, against N before. With the 2 measured `blocked` desks, a `ps` sample of 200 s shows 0 `pr-state` calls, against 2 per tick before, and the burst shrinks from 3 lines to 1. `mine=` for a tick equals 60 × the host calls counted since the previous reading, including every nothing-done and release call; the unit tests above prove it.
- **Slice 2.** With fleetd on current code and a store at `PR_INDEX_VERSION` 5: when every branch named by an Approved plan has a MERGED row, a `ps` sample of 200 s shows 0 `pr-list --state merged` calls and the tick line prints `merged-set=index`; when one such branch has no row, the sample shows 1 call per tick and the tick line prints `merged-set=whole`. A skipped tick saves 1 line and about 5 requests, about 215 requests per hour at 43 ticks per hour. The saving shows only once fleetd runs current code and writes a version-5 store; on 2026-10-26 the 8 branches of Approved plans with no MERGED row would make every tick `ask`.

### Changesets

Each slice adds a changeset for package `plot`, with its Changelog line as the description.

### Open Questions

- [x] Which process and which operation spend the 610 lines per hour? — fleetd. The nothing-done step's `pr-state` calls are about 430 of 618 lines per hour with about 10 leftover desks (inferred from the burst shape); the rest are fleetd listings. See *Callers*.
- [x] Does the board read the host while fleetd owns the PR index? — No GraphQL call. The `ps` sample shows only `gh run list` (core) and `plot-host.sh backend`.
- [x] Does a caller field in the record answer the question for good? — Not needed here. A `ps` sample of 200 s attributed every GraphQL call to its parent process and operation, so the Rejected plan stays rejected.
- [x] What does the plan accept as done for the nothing-done step? — Operator decision 2026-10-26: the step spends 0 calls per tick for desks whose verdict does not read `prOpen`, and `mine=` reports every call the step makes, the claim release included. The plan sets no total idle target.
- [x] Does `mine=` change its formula? — No. The acceptance is stated per tick; see *Acceptance*.
- [ ] May the tick's merged read be the index's MERGED rows joined with a host delta (`pr-list --state merged --since <watermark>`, one page) whenever the store decodes with `complete: true`? That read saves about 4 of 5 requests on every tick, also while Approved work is unmerged, but it takes a branch missing from both as `whole` up to the watermark, which reads `complete: true` as a statement about missing rows. CLAUDE.md *A Decision Reads The Index* does not settle that reading. Operator decision; slice 2 does not depend on it.

## Slices

### Ask Only Where It Decides

- `bug/nothing-done-asks-pr-state-only-where-it-decides` — ask `commitBeyondClaim` and `prOpen` only where `ending-action.ts:346-347` reads them, build the nothing-done ports with `tally`, count the release's host calls, and reset `tally` at the spend reading with the thrown and incomplete paths named

### Skip The Merged Listing

- `feature/the-tick-reads-merged-branches-from-the-index` — a domain rule in `rules/known-pr.ts` skips the tick's `pr-list --state merged --limit 500` when MERGED index rows settle every branch of every Approved plan, and the tick line prints `merged-set=index` <!-- waits: bug/nothing-done-asks-pr-state-only-where-it-decides -->

## Notes

- Source: issue #2715, https://github.com/plot-pm/plot/issues/2715. The measurement is also posted as a comment there.
- Panel round 1 (unanimous amend) found that 0 of 184 recorded endings are `nothing-done`, so the earlier slice 2, which answered the nothing-done `prOpen` from an OPEN index row and added an OPEN-row exception to CLAUDE.md *A Decision Reads The Index*, would save close to 0 requests per hour. The operator replaced it on 2026-10-26 with the merged-listing slice, which reads only MERGED rows under the existing rule, and withdrew the earlier decision that allowed the OPEN-row exception. This plan adds no exception to that section.
- Out of scope: the scan's `pr-list --state all --limit 3000` (`plot-fleet-scan.sh:1063`), about 25 lines and about 450 requests per hour (derived from 18 pages per call), the largest idle spender in requests. See #2720.
- Follow-up, not in this plan: `budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process, so paged `pr-list` calls under-count real GraphQL requests. It concerns every paged listing and the record's format. It is filed as #2717.
- Follow-up, not in this plan and not filed: `readNothingDoneCandidates` (`registryd.ts:1290`) does not apply the `ending.branch === tree.branch` guard that the fresh-agent reader applies (`registryd.ts:867`), so an ending left by an earlier branch at the same path can produce `release-claim` for the current branch. `releaseClaim`'s refusals still stand in front of it. Panel round 1, safety juror; pre-existing.
- Not explained: the burst of 96–236 requests per minute on 2026-10-25 at 20:42–20:50 (peak hour 2,017). The `ps` sample covers 2026-10-26 only. With desks running, the fresh-agent and nothing-done steps see more candidates, which fits a burst, but no sample of that window exists. Operator decision 2026-10-26: investigate only if it recurs after #2717 makes the record count pages.
- Cited lines verified on `origin/main` at `3e013e290`.
