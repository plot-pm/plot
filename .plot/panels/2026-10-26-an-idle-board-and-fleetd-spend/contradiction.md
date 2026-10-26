# Juror verdict — lens: contradiction

Plan: `docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md` at `f84562650`. Code: `origin/main` `ea2aa9743`. Every cited line was **read** in `p2716-main` unless the claim says **ran**.

Position: amend

## Summary

The verdict-safety argument of slice 1 holds: the code agrees with the plan. Five statements disagree with each other, with the code or with CLAUDE.md. Two of them make the acceptance unreachable or ambiguous as written: the `mine=` acceptance and the scope of "every nothing-done host call". The plan needs text changes before approval. It needs no redesign.

## C1. The acceptance asks `mine=` and the record to move by the same amount, and the formula prevents it (HIGH)

- Plan, Acceptance: *"The `mine=` field moves by the same amount as the record."*
- Plan, Acceptance: *"against 2 per tick (about 80 per hour) before"*. Plan, Callers: *"every tick (≈ 90 s)"*, *"~430 (about 10 desks × 40 ticks)"*.
- Code: `spendForTick` computes `minePerHour: boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:407`), and `boardSharePerHour = (HOUR_MS / intervalMs) * costPerRefresh` (`cadence.ts:72-73`). `intervalMs` defaults to `TICK_INTERVAL_MS = 60_000` (`registryd.ts:80`). The formula assumes 60 ticks per hour.
- Result: 2 calls per tick move `mine=` by 120/hr. The plan's own tick period moves the record by about 80/hr. The plan's evidence already shows the gap: `mine=60/hr` for the one merged-list call per tick, against *"~40 lines"* per hour for the same call in the Callers table.
- Amend: either state the acceptance as "`mine=` per tick increases by the number of nothing-done host calls in that tick", or change the formula to the measured tick period. The current sentence cannot pass.

## C2. "Count every nothing-done host call" against "the nothing-done port adds 1" (HIGH)

- Slice 1 line: *"count every nothing-done host call in `tally`"*. Operator decision: *"`mine=` reports every call the step makes"*.
- Design 3: *"The nothing-done port adds 1 to `tally` for each host call, as the fresh-agent port does."* The port is the `prOpen` port at `registryd-main.ts:2480`.
- Design 2: *"`gatherReadingsAndRelease` asks `prState` and `prMerged` again before it releases (`release-claim-reader.ts:72`, `:74`)"*.
- Code: those two calls run in `prReading` through `releaseClaimOf` (`registryd-main.ts:2151-2153`), which receives no `tally`. So a `release-claim` verdict costs 3 host calls, and the design counts 1.
- Amend: name the release reads as counted (pass `tally` into `releaseClaimOf` or count around `release`), or narrow the slice text and the operator decision's wording to the `prOpen` port.

## C3. Moving the reset contradicts the rate formula on an incomplete or failed tick (MEDIUM)

- Design 3: *"The loop resets `tally.calls` after the spend reading instead of at the top of the tick, so a reading counts every host call since the previous reading"*.
- Code: the spend reading runs only when `report.incomplete === ''` (`registryd-main.ts:2421-2423`). A tick that throws `continue`s before it (`:2389-2409`). With the reset moved after the reading, the calls of an incomplete or failed tick roll into the next reading. `boardSharePerHour` still divides by one interval (C1), so `mine=` over-reports after every incomplete tick.
- Today the reset at `:2366` discards those calls, so the rate is low but never inflated. The plan does not say which error it accepts.
- Amend: reset at the reading and also on the incomplete and catch paths, or state that a reading after an incomplete tick covers several intervals.
- **Read**: `tally.calls` has one reader, `:2422` (grep). No other reader of `tally` changes.

## C4. Slice 2 against CLAUDE.md on draft rows (MEDIUM)

- CLAUDE.md, *A Decision Reads The Index*: *"`OPEN`, `CLOSED` and draft rows are stale in either direction"*, and the named test *"a draft row is re-asked rather than answered from"*. `test/reconcile/impl-status-index.test.mjs:239`: *"A DRAFT IS ASKED ABOUT WHATEVER ITS STATE SAYS."*
- Plan, slice 2: *"answer `prOpen: true` from an `OPEN` index row for the branch"*. A draft PR has `state: 'OPEN'` and `draft: true` (`pr-index.ts:36-38`).
- The plan's exception covers `OPEN` rows and says nothing about draft rows. The CLAUDE.md text it amends treats draft rows as a separate class. For `prOpen` a draft row answers `true` safely: `prOpenReading` ignores `draft` (`registryd.ts:1314`). The exception text must say so, or CLAUDE.md keeps two rules that disagree.
- I found no path where the `true` answer releases, deletes or hides work: it reaches only `endingAction` row `:347`, which answers `leave`. **Read.**

## C5. The root cause names "10 desks", and the measured state has 2 (MEDIUM)

- Summary: *"fleetd's nothing-done step spends most of them … This plan asks only where the answer decides"*.
- Callers: *"~430 (about 10 desks × 40 ticks)"*, basis *"attribution inferred"*.
- Measured spend: *"2 plan-named worktrees had no manifest … Both desks hold the ending `blocked`."*
- Acceptance: *"With the 2 measured `blocked` desks, … 0 lines per hour after the change, against … about 80 per hour before."*
- **Ran** (node over `~/.plot/state/budget.tsv.1`, gap < 3 s): night bursts of ≥ 3 lines number 346, and their sizes are 11 (170), 12 (83), 13 (44). That fits 1 merged list plus 10–12 `pr-state` calls, so about 10 desks existed at night. On the 26th at 18:40–18:44 the record holds 25 GraphQL lines, and bursts of 3 lines appear (1 + 2).
- The plan never reads the endings of the night's ~10 desks. A `nothing-done` desk with no commit beyond its claim still needs `prOpen`, and with no PR the index has no `OPEN` row, so neither slice removes its call. The Summary implies that the fix removes "most" of 610/h. The Acceptance and the operator decision promise 80/h. Amend the Summary to say the fix removes the calls for desks whose ending does not read `prOpen`, and that the night share depends on the endings of desks no longer present.
- Also: the plan cites `unclaimed=8|10` beside the desk count. `unclaimed` counts `!isMain && !registered && !planNamed` (`unclaimed.ts:77-78`), the complement of the nothing-done population (`registryd.ts:1262`, `planNamed`). The figure says nothing about the nothing-done step and invites the reader to take 10 from it. Say so or drop it.

## C6. Smaller disagreements (LOW)

- **Title against body.** Title: *"An idle board and fleetd spend about 610 GitHub GraphQL requests per hour"*. Body: *"The board (pid 23604) spawned only `gh run list` (core) … and no GraphQL call"*, and the Callers row *"board … 0"*. Retitle around fleetd.
- **Code comment already claims the fix.** `registryd.ts:1403`: *"matching `commitBeyondClaim` and `prOpen`'s own filler pattern for endings that don't need them"*. At `:1396-1397` both are asked for every candidate, so no filler pattern exists for them. Slice 1 makes the comment true; the plan should name it so the reviewer checks it.
- **"One page" against "about 5 pages".** `queue-reading.ts:325`: *"A WHOLE LISTING IS ONE PAGE. It names the host's newest 500 merged PRs"*. Plan: *"~40 lines, about 200 requests"* for the same `--limit 500` call. Both can hold (one domain listing, five GraphQL pages), but #2717 should name the term.
- **Shared CLAUDE.md section.** Slice 2 adds an exception to *A Decision Reads The Index*. The Approved plan `2026-10-23-one-pr-reader-per-machine-and` (`:159`, `:203`) rewrites the *One writer* paragraph of the same section in two slices, three of which are Started. *"this plan does not depend on it"* holds for code and not for that text; slice 2 should rebase onto whichever lands first.
- **Burst count.** Plan: *"326 bursts"*, mean 11.6. My grouping (gap < 3 s, ≥ 3 lines) gives 346, mean 11.1 (**ran**). The definition is not stated in the plan; state it.

## Rubric answers

1. **Root cause.** The code path is correct: `run()` → `startNothingDoneReleases` (`registryd-main.ts:2471`) → `nothingDoneDecisions` (`registryd.ts:1374`) asks `prOpen` for every non-bound candidate (`:1397`) through `pr-state`, one `gh pr view … statusCheckRollup` (`plot-host.sh:4008`), with no memo. **Read.** The ~430 share is plausible for ~10 desks (**ran**, C5), but the desk count at night is inferred, and the claim that those calls never decide is shown only for the 2 desks of 18:40. The fresh-agent step asks `prOpen` only for `bound` endings and `prMerged` only for not-yet-asked outright and bound endings (`registryd.ts:894-908`), so it does not explain the 2 calls per tick for 2 asked `blocked` desks. **Read.** Missed spender: a `release-claim` verdict that repeats each tick costs 3 calls (C2); the plan does not say whether a released desk leaves the candidate set. Not verified.
2. **Verdict safety.** Slice 1: `endingTableAnswer` reads `prOpen` only at `ending-action.ts:347` after `ending === 'nothing-done'` and `commitBeyondClaim === 'no'`. Bound endings are filtered at `registryd.ts:1384`. `endingReleaseBranch` (`:393-394`) does not read `prOpen`. `startNothingDoneReleases` acts on `release-claim` only. No verdict changes. **Read.** Slice 2: `true` yields `leave` only; no release, delete or hide path. Draft rows need the CLAUDE.md wording (C4).
3. **Tally fix.** One reader of `tally.calls` (`:2422`). Moving the reset changes no other reader. It changes `mine=` after incomplete or failed ticks (C3), and the acceptance sentence conflicts with the formula (C1).
4. **Slices against Changelog and acceptance.** Slice 1 ships an observable result (fewer `pr-state` lines, a moved `mine=`). Slice 2 ships fewer `pr-state` lines only for desks with an `OPEN` PR and no commit beyond the claim, a rare case the plan does not size. The record writes one line per `gh` process (#2717); `pr-state` is one request per process, so the nothing-done acceptance is measurable today. The `mine=` half is not (C1).
5. **New defects.** C2 (uncounted release reads), C3 (reset on incomplete ticks), C4 (draft rows), the stale comment at `registryd.ts:1403`. The `prOpen` port in `run()` is built inline at `:2480` and receives no `tally`, so the planned one-tick `mine=` test needs a seam the plan does not name.

## Required amendments

1. Rewrite the `mine=` acceptance so the formula can meet it (C1).
2. Decide whether the release reads count, and make the slice text and Design 3 say the same thing (C2).
3. State the reset behaviour on incomplete and failed ticks (C3).
4. Name draft rows in the slice 2 exception and in the CLAUDE.md text it adds (C4).
5. Align the Summary with the measured 2 desks and the inferred 10, and drop or explain `unclaimed=8|10` (C5).
