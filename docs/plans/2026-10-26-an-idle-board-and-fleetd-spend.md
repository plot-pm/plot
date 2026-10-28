# An idle fleetd spends about 610 GitHub GraphQL lines per hour

> With no desk, worker loop or Claude session running, one board and one fleetd on the plot repository recorded 4,966 GitHub lines in 8 hours, and the board recorded no GraphQL line. fleetd's nothing-done step spends about 70 % of the lines and about 35 % of the requests: it asks the host for the PR state of every leftover plan-named worktree on every tick, also where the answer cannot change its verdict, and no counter reports the call. The tick's merged-PR listing spends about 215 requests per hour more. This plan asks the nothing-done question only where the answer decides, counts every call the step makes, and reads the tick's merged set from the PR index plus a one-page host delta instead of a 500-row listing.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2715
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2716 merged
- **Started:** 2026-10-26, Jan Wloka, `bug/nothing-done-asks-pr-state-only-where-it-decides`
- **Started:** 2026-10-26, Jan Wloka, `feature/the-tick-reads-merged-prs-as-an-index-delta`
- **Delivered:** 2026-10-26
- **Released:** 2026-10-28, v2.29.0

## Changelog

- fleetd asks the host for a leftover desk's PR state only for a `nothing-done` desk with no commit beyond its claim, and the tick line's `mine=` counts every host call the nothing-done step and its claim release make.
- fleetd's tick reads its merged set from the PR index's MERGED rows plus one host delta (`pr-list --state merged --since <watermark − 60 s>`) when the store is current and `complete: true`, instead of `pr-list --state merged --limit 500`, and the tick line prints `merged-set=delta` for that tick. CLAUDE.md *A Decision Reads The Index* names this one consumer.

<!-- Board impact: none. The board makes no GraphQL call while fleetd owns PRs (measured 2026-10-26). The board reads no `merged-set` field and no `mine=` field and does not read the PR index through the new rule, and neither slice changes the plan format, the template, a helper script or the docs/plans layout. -->

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

### A wrong "not merged"

A branch missing from the set only holds or re-asks work. Read on `origin/main`:

- Its slice stays outstanding in `planQueue`, so the later slices of its plan stay held (`queue.ts:906`).
- A `waits:` prerequisite it names reads `unmerged`, so the waiting slice stays held (`queue.ts:855`).
- A queued slice that a hand-over would pass is asked again per branch through `queuedHasLanded` (`queue-reading.ts:383`) before any hand-over, at the cost of one host call.
- `claimReadingsOf` reads its ref with git and can name it in the `orphaned-claims` report, which names a branch and releases nothing (`registryd-main.ts:2687`).

No path from the merged set starts an agent, releases a claim or deletes a ref. A wrong *not merged* therefore costs a held slice and at most one per-branch host call per tick, until a later tick's read names the branch.

### The index today

The PR index holds rows only for a store that decodes at `PR_INDEX_VERSION` 5 (`entities/pr-index.ts:12`). The live store at `.plot/state/index/github.json` is `v: 4` (written 2026-10-26 19:06Z by fleetd pid 8692, started 2026-10-17), so `prIndexRows` (`registryd-main.ts:843`) reads no rows until fleetd runs current code. Decoded by hand, that store holds 1,002 rows and reads `complete: true`. Of the 35 non-deferred branches named by plans that are not Delivered or Released, 28 have no MERGED row; of the branches named by Approved plans, 8 have none. *Measured 2026-10-26.*

The store carries three clocks (`entities/pr-index.ts:123-154`). `watermark` is the newest `updatedAt` of any stored row, the host's own value (`watermarkOf`, `rules/pr-index.ts:23`). `at` is when this machine wrote the file, and every delta moves it. `wholeAt` is when this machine last folded a full read, at most `PR_FULL_READ_MS` (24 h, `pr-refresh.ts:331`) ago on a healthy store. fleetd's own PR refresh asks its delta from `watermark` (`prWindowFor`, `rules/pr-index.ts:411`, `:413`) every `PR_REFRESH_MS` (60 s, `fleet-scan.ts:17`), and the store holds up to `PR_LIMIT` = 1,000 PRs of every state (`pr-refresh.ts:303`), against the listing's 500 merged PRs.

### Related plans

- [2026-10-23-one-pr-reader-per-machine-and](2026-10-23-one-pr-reader-per-machine-and.md) (#2386, Approved) gives the boards of one repository one PR reader. The board makes no GraphQL call while fleetd owns PRs, and neither step in this plan is a PR reader of the boards, so that plan does not change this rate, and this plan does not depend on it for code. Both plans edit CLAUDE.md *A Decision Reads The Index*: #2386 rewrites its *One writer* paragraph, and slice 2 here adds a paragraph after *The index never says no*. The slice that lands second rebases its text onto the first.
- [2026-10-16-fleetd-scan-cost-and-read-cadence](2026-10-16-fleetd-scan-cost-and-read-cadence.md) (Released) bounded the fleet scan's reads. The scan listing in the table above is within that bound.
- [2026-10-01-a-shared-account-names-what-spends-it](2026-10-01-a-shared-account-names-what-spends-it.md) (Released) measured callers by instrumenting a process. This plan used a `ps` sample instead.
- [2026-09-29-a-spend-line-names-its-caller](2026-09-29-a-spend-line-names-its-caller.md) (Rejected) proposed a caller field in the record. The `ps` sample attributed the spend without it.

## Design

### Approach

1. **Ask only where the answer decides.** In `nothingDoneDecisions`, ask `commitBeyondClaim` only for a candidate with ending `nothing-done`, and ask `prOpen` only for a candidate with ending `nothing-done` and `commitBeyondClaim === 'no'`. Every other candidate gets the filler `'unanswerable'` for both, which takes the same arm as `'yes'` and `true` and so points away from `release-claim`. `endingAction` returns the same verdict for every candidate, because on this path `ending-action.ts:346` and `:347` are the only rows that read the two readings. The comment at `registryd.ts:1403` then describes the code.
2. **Count every call the step makes.** Extract the nothing-done ports at `registryd-main.ts:2475-2490` into a builder that takes `tally`, the shape `freshAgentDeskReads` (`registryd-main.ts:1534`) already has. The builder's `prOpen` port adds 1 to `tally` for each host call. `releaseClaimOf` takes `tally` too and adds 1 for each host call `prReading` makes in `gatherReadingsAndRelease` (`release-claim-reader.ts:72`, `:74`): 2 when the state answers, 1 when it does not. The fresh-agent step shares `releaseClaimOf`, so its releases count too.
3. **Reset the tally where a reading takes it.** The loop sets `tally.calls = 0` directly after the spend reading (`registryd-main.ts:2422`), so the next reading counts the calls of the post-report steps of this tick and the calls of the next tick up to its reading. A tick that takes no reading, because it threw (the `continue` at `registryd-main.ts:2410`) or was incomplete (`report.incomplete !== ''`), makes the next tick reset `tally.calls` to 0 at its top, as the loop does today. So no reading counts the calls of two intervals: the calls of a thrown or incomplete tick, and the post-report calls of the tick before it, are dropped, as today. The `HostTally` TSDoc (`registryd-main.ts:358-364`) and the comment at `:2367` change to state this.
4. **Read the merged set as the index plus a host delta.** A pure domain rule in `packages/domain/src/rules/known-pr.ts`, beside `indexMergedHeads`, takes the store as read (or null) and answers `delta` with a `since` stamp, or `full`. It answers `delta` only when the store decodes at `PR_INDEX_VERSION`, reads `complete: true`, and carries a `watermark` that parses; `since` is the watermark minus 60 s, rendered as `YYYY-MM-DDTHH:MM:SSZ`. It answers `full` for a missing, old-version or unparseable store, for `complete: false`, and for a missing or unparseable watermark. On `delta`, `mergedBranches` (`registryd-main.ts:780`) asks `pr-list --state merged --since <since> --limit 500` once, adds 1 to `tally`, and answers the union of the delta's MERGED heads and `indexMergedHeads` of the rows, with `whole: true`; the tick line prints `merged-set=delta`. A delta that fails, leaves a refusal behind, or returns 500 rows is not used: the tick then asks `pr-list --state merged --limit 500` as today. On `full` the tick asks the listing as today. `readQueue` keeps joining the rows (`queue-reading.ts:331-333`) in both cases. The host port's `prList` (`host-shell.ts:444`) gains an optional `since`, which `plot-host.sh pr-list --since` already takes on both hosts.

   **Why the watermark.** It is the field fleetd's own PR refresh narrows from (`rules/pr-index.ts:411`), and it is the host's clock, so no client skew enters the window; `plot-host.sh:186-191` records that a re-rendered client stamp excludes the PRs of the skew gap from every later window. `at` is this machine's clock and has that defect. `wholeAt` is also this machine's clock and is up to 24 h old, so a window from it re-reads a day of merges on every tick. Every PR merged after the store's last fold has a host `updatedAt` later than the watermark, because a merge updates the PR, so the delta names it whatever the store's age.

   **Why 60 s of overlap.** `updated:>` is exclusive (`plot-host.sh:4475-4479`): a PR updated in the same second as the watermark is missed, and only the daily full read corrects it. For the PR refresh that miss costs a stale row for up to 24 h; here it would hold a merged branch's later slices for up to 24 h. 60 s is one `PR_REFRESH_MS`, so the overlap covers the same-second case and one refresh interval of host-side ordering, and costs only the rows merged in that minute, which a page of 100 holds. The subtraction is arithmetic on the host's stamp and not this machine's clock, and the result keeps the host's own spelling (`2026-10-26T19:06:30Z`), so the skew defect of `plot-host.sh:186-191` does not apply.

   **The rule change ships in the same slice.** CLAUDE.md *A Decision Reads The Index* gains one paragraph after *The index never says no*:

   > **One consumer reads a complete store plus a host delta as its merged listing.** fleetd's tick (`mergedBranches`) takes as its merged set the store's non-draft MERGED rows plus one host call, `pr-list --state merged --since <watermark − 60 s>`, when the store decodes at `PR_INDEX_VERSION` and reads `complete: true`. A missing, old-version, unparseable or `complete: false` store, and a delta that fails, answers partial or fills its limit, fall back to the full `pr-list --state merged --limit 500`. The index still never says `pr: 'none'`: a branch absent from both reads *not merged per this read*, which only holds its slice or sends it to the per-branch `queuedHasLanded` question before a hand-over, and starts, releases or deletes nothing. This licence is for this one consumer; another consumer needs its own paragraph here.

   The slice then runs `./scripts/check-agents-md.sh --write` to regenerate `AGENTS.md`.

### Tests

- Slice 1: the builder is called with one candidate per ending (`null`, `nothing-done` with `commitBeyondClaim` `'no'`, `'yes'` and `'unanswerable'`, `holding-work` with and without a refused assignment, every fresh-session ending and every outright-person ending). It asserts one `prOpen` host call for `nothing-done` with no commit beyond the claim and zero for every other candidate, one `commitBeyondClaim` call per `nothing-done` candidate and zero for the others, and that `tally` equals the number of host calls. A second test asserts that the verdicts equal the verdicts of the current code for the same readings. The existing `nothing-done-tick.test.ts:179` keeps passing.
- Slice 1: a release through `releaseClaimOf` with a stubbed host adds 2 to `tally`, and 1 when the state does not answer.
- Slice 1: a `run()` test with a stubbed tick runs a complete tick, a tick that throws, and a complete tick, and asserts that the third tick's reading counts only the third tick's own calls.
- Slice 2: the rule answers `delta` with `since` = watermark − 60 s for a current, `complete: true` store with a watermark; `full` for a null store, `complete: false`, a null, empty or unparseable watermark. The caller's decode answers null for an old-version or unparseable file, and a test with each proves the `full` path.
- Slice 2: `queueWorldForRepo` with a fixture store and a stubbed host asks one `prList` with `since` on `delta` and unions its MERGED heads with the rows' non-draft MERGED heads; an OPEN, CLOSED or draft row adds nothing. A delta that fails, leaves a refusal or returns the limit makes a second call without `since` and `--limit 500`. A `full` store makes one call without `since`.

### Acceptance

Stated per tick, not in `mine=` units over an hour. `mine=` multiplies a tick's calls by the configured 60 s interval, and the real tick period varies with the tick's cost (12–40 s), so a per-hour comparison of `mine=` with the record cannot pass. Changing the formula to the measured period changes a field every tick line prints and is outside this plan.

- **Slice 1.** With N leftover plan-named worktrees and no manifest, of which M hold the ending `nothing-done` with no commit beyond the claim, the nothing-done step makes M `pr-state` calls per tick, against N before. With the 2 measured `blocked` desks, a `ps` sample of 200 s shows 0 `pr-state` calls, against 2 per tick before, and the burst shrinks from 3 lines to 1. `mine=` for a tick equals 60 × the host calls counted since the previous reading, including every nothing-done and release call; the unit tests above prove it.
- **Slice 2.** Before: a `ps` sample of 200 s shows one `pr-list --state merged --limit 500` per tick, 5 pages (about 5 requests) per tick. After, with fleetd on current code and a version-5 store that reads `complete: true`: the sample shows one `pr-list --state merged --since … --limit 500` per tick and no `--limit 500` read without `--since`, and the tick line prints `merged-set=delta`. The delta answers the merges of the last fold plus 60 s, which is under 100 rows, so 1 page per tick: about 4 requests saved per tick, about 170 per hour at 43 ticks per hour. The rule does not depend on which branches the plans name, so it fires on today's estate once fleetd restarts on current code and writes a complete version-5 store; until then the `v: 4` store gives `full`, and the sample shows the 500-row read as today.

### Changesets

Each slice adds a changeset for package `plot`, with its Changelog line as the description.

### Open Questions

- [x] Which process and which operation spend the 610 lines per hour? — fleetd. The nothing-done step's `pr-state` calls are about 430 of 618 lines per hour with about 10 leftover desks (inferred from the burst shape); the rest are fleetd listings. See *Callers*.
- [x] Does the board read the host while fleetd owns the PR index? — No GraphQL call. The `ps` sample shows only `gh run list` (core) and `plot-host.sh backend`.
- [x] Does a caller field in the record answer the question for good? — Not needed here. A `ps` sample of 200 s attributed every GraphQL call to its parent process and operation, so the Rejected plan stays rejected.
- [x] What does the plan accept as done for the nothing-done step? — Operator decision 2026-10-26: the step spends 0 calls per tick for desks whose verdict does not read `prOpen`, and `mine=` reports every call the step makes, the claim release included. The plan sets no total idle target.
- [x] Does `mine=` change its formula? — No. The acceptance is stated per tick; see *Acceptance*.
- [x] May the tick's merged read be the index's MERGED rows plus a host delta whenever the store is current and `complete: true`? — Yes, operator decision 2026-10-26. Slice 2 does it and adds the licence for this one consumer to CLAUDE.md *A Decision Reads The Index*.

## Slices

### Ask Only Where It Decides

- `bug/nothing-done-asks-pr-state-only-where-it-decides` — ask `commitBeyondClaim` and `prOpen` only where `ending-action.ts:346-347` reads them, build the nothing-done ports with `tally`, count the release's host calls, and reset `tally` at the spend reading with the thrown and incomplete paths named → #2732

### Merged Delta Read

- `feature/the-tick-reads-merged-prs-as-an-index-delta` — a domain rule in `rules/known-pr.ts` makes the tick's merged set the index's MERGED rows plus `pr-list --state merged --since <watermark − 60 s>` for a current, complete store, falls back to the 500-row listing otherwise, prints `merged-set=delta`, adds the one-consumer paragraph to CLAUDE.md *A Decision Reads The Index* and regenerates `AGENTS.md` <!-- waits: bug/nothing-done-asks-pr-state-only-where-it-decides --> → #2738

## Notes

- Source: issue #2715, https://github.com/plot-pm/plot/issues/2715. The measurement is also posted as a comment there.
- Panel round 1 (unanimous amend) found that 0 of 184 recorded endings are `nothing-done`, so the earlier slice 2, which answered the nothing-done `prOpen` from an OPEN index row and added an OPEN-row exception to CLAUDE.md *A Decision Reads The Index*, would save close to 0 requests per hour. The operator replaced it on 2026-10-26 with a merged-listing slice and withdrew the earlier decision that allowed the OPEN-row exception.
- The first replacement skipped the merged listing only when MERGED rows settled every branch of every Approved plan, the `plot-reconcile-scan.sh` precedent (#1022). On 2026-10-26, 8 branches of Approved plans had no MERGED row, so it would skip on no tick while any Approved work is unmerged. The operator decided on 2026-10-26 to read the merged set as the complete store plus a host delta instead, with the CLAUDE.md licence for this one consumer in the same slice. The branch `feature/the-tick-reads-merged-branches-from-the-index` never started and is replaced.
- Out of scope: the scan's `pr-list --state all --limit 3000` (`plot-fleet-scan.sh:1063`), about 25 lines and about 450 requests per hour (derived from 18 pages per call), the largest idle spender in requests. See #2720.
- Follow-up, not in this plan: `budget_record_call` (`plot-host.sh:3576`) writes one line per `gh` process, so paged `pr-list` calls under-count real GraphQL requests. It concerns every paged listing and the record's format. It is filed as #2717.
- Follow-up, not in this plan and not filed: `readNothingDoneCandidates` (`registryd.ts:1290`) does not apply the `ending.branch === tree.branch` guard that the fresh-agent reader applies (`registryd.ts:867`), so an ending left by an earlier branch at the same path can produce `release-claim` for the current branch. `releaseClaim`'s refusals still stand in front of it. Panel round 1, safety juror; pre-existing.
- Not explained: the burst of 96–236 requests per minute on 2026-10-25 at 20:42–20:50 (peak hour 2,017). The `ps` sample covers 2026-10-26 only. With desks running, the fresh-agent and nothing-done steps see more candidates, which fits a burst, but no sample of that window exists. Operator decision 2026-10-26: investigate only if it recurs after #2717 makes the record count pages.
- Cited lines verified on `origin/main` at `3e013e290`.
