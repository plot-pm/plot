# Juror verdict — safety lens

Plan: `docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md` at `f84562650`. Code cited from `p2716-main` at `ea2aa9743`. Every claim below is **read** from source unless marked **ran**. I ran only `grep`/`git grep`/`sed` over the tree; I ran no node snippet and no test.

Position: amend

## Summary

Slice 1 is safe: no verdict, release branch or log line changes. Slice 2 is safe for the nothing-done port, and the destructive step keeps its own host read. Four changes are needed first. (a) Slice 2 must name the one port it changes, because the fresh-agent step asks `prOpen` through a second port where `true` starts a session. (b) An `OPEN` row needs a staleness bound, or a stopped index writer holds a dead desk's claim with no end and no log line. (c) The CLAUDE.md exception must state "the answer's only effect is `leave`" rather than "releases nothing". (d) The tally reset needs a rule for ticks that take no spend reading.

## 1. Root cause

- Read: the tick loop calls `startNothingDoneReleases` (`registryd-main.ts:2471`) only under `args.startAgents && report.incomplete === ''`. It calls `nothingDoneDecisions` (`registryd.ts:1374`), which awaits `prOpen` serially for every candidate that is not `bound`/`unreadable`/`quiet` (`registryd.ts:1397`). The port at `registryd-main.ts:2480` calls `hostShell(...).prState(branch)` with no memo and no `tally` increment. The plan's mechanism is correct.
- Read: the candidate filter (`registryd.ts:1259`) includes desks with no ending file (`ending: null`) and every ending other than the bound three. So every leftover plan-named worktree costs one `gh pr view` per tick, whatever its ending. That fits the serial ~1.2 s bursts.
- Not checked: I did not verify the "about 10 leftover desks" at 00:00–07:59. The plan marks that share as inferred, and the `ps` sample shows only 2. The 430/618 share is plausible, but no measurement in the plan covers that window.
- Read, not missed: the fresh-agent step also asks `prOpen` (`registryd-main.ts:1594`), but only for bound endings not yet asked (`registryd.ts:908`), and it counts the call. With 2 `blocked` desks it asks `prMerged` through the shared merge memo at most, and only until the ask is recorded (`registryd.ts:898-901`).

## 2. Verdict safety

### Slice 1 — no verdict changes (read)

Every reader of the nothing-done decision:

1. `endingAction` (`ending-action.ts:320-349`). The nothing-done step passes `hasManifest: false` and `endingAsked: false`. It also passes `prMerged: 'unanswerable'`, `freeWait: false`, `blockedMarker: false` and `dirtyTree: 'no'`. `prOpen` is read only on line 347, after `ending === 'nothing-done'` (`:345`) and `commitBeyondClaim === 'no'` (`:346`). The other rows read no `prOpen` and return before it: `holding-work` (`:328-331`), the fresh-session endings (`:332-334`) and the outright-person endings (`:342-344`). The bound row (`:335-341`) reads `prOpen` through `boundBranchHoldsWork` (`:199`), but `nothingDoneDecisions` skips bound endings before it builds readings (`registryd.ts:1383-1386`). The `endingAsked` guard (`:322`) reads no `prOpen`. So the filler `'unanswerable'` for every other candidate returns the same verdict.
2. `endingReleaseBranch` (`ending-action.ts:393`) reads `ending`, `refusedAssignment` and `branch` only.
3. `applyNothingDoneDecisions` (`registryd.ts:1452`) reads `verdict` and `branch` only. A `leave` decision produces no entry.
4. `nothingDoneLines` and `startNothingDoneReleases` (`registryd-main.ts:1760-1785`) read only the applied list. No decision or reading is persisted or written to the supervision report.
5. `git grep` (**ran**) finds no other production caller of `nothingDoneDecisions` or of the nothing-done `prOpen` port.

The plan's second test ("verdicts equal the current code for the same readings") is the right proof. It must include `ending: null`, `holding-work` with and without a refused assignment, and every outright-person reason.

### The destructive step keeps its own read (read)

`gatherReadingsAndRelease` asks `host.prState` and `host.prMerged` again (`release-claim-reader.ts:72`, `:74`). `releaseClaim` refuses `pr-open` for an open or merged PR and for an unanswered read (`dispatch-verbs.ts:493-501`). So even a wrong `prOpen: false` cannot release a branch that has a PR. The nothing-done `prOpen` is a pre-filter in front of that refusal.

### Slice 2 — paths where an `OPEN` row can hold, start or hide

- **Nothing-done port (`registryd-main.ts:2480`).** Read: `true` reaches only line 347 and gives `leave`. It releases nothing and starts nothing. Safe.
- **Fresh-agent port (`registryd-main.ts:1594`) — the plan does not exclude it.** Approach 2 says "Answer `prOpen` from the PR index" and does not name a port. Only the branch name says "nothing-done". In the bound row, `prOpen: true` makes `boundBranchHoldsWork` true (`ending-action.ts:199`). The verdict then becomes `start-fresh` or `needs-a-person` (`:340`), not `leave`. A stale `OPEN` row for a PR closed unmerged then starts a fresh agent session or asks a person, where the host answer gives `release-claim`. That spends a session and writes an ask. It releases nothing, so the proposed CLAUDE.md wording ("only where a wrong answer releases nothing") would allow it. **Amend:** slice 2 changes only the port at `registryd-main.ts:2480`. A test asserts that the fresh-agent `prOpen` port still asks the host for a bound desk whose branch has an `OPEN` index row.
- **A stale `OPEN` row holds the claim with no bound.** Read: `prIndexRows` (`registryd-main.ts:843-849`) returns the rows of any decodable store whatever its `at`. The plan argues that "the next PR refresh corrects the row". That holds only while a refresh runs and succeeds. If the writer stops, is throttled, or another process owns PRs and stops, the row stays `OPEN`. The nothing-done desk then answers `leave` on every tick, the claim stays on a dead desk, and the slice is not dispatched again. A `leave` decision writes no line (`registryd.ts:1457`), so nothing names the cause. This is the "hidden" case in my lens. The repo already solved this shape for `default-branch.json`: a reading older than `Checks wait` counts as no reading. **Amend:** an `OPEN` row answers `true` only when the store's `at` is within a stated bound (for example `Checks wait`, or N PR-refresh intervals). An older store asks the host. Add a test with an old `at` and an `OPEN` row that asserts one host call.
- **Head-name collision (minor).** Read: a row is keyed by `head` only (`entities/pr-index.ts:34-35`). An open PR from a fork with the same branch name answers `true` and holds the claim. This is the `leave` direction and is the same as the host's own `gh pr view <branch>` answer today, so it adds no new risk. Note it in the test fixtures and do not fix it here.
- **Pre-existing, not changed by the plan.** Read: `readNothingDoneCandidates` (`registryd.ts:1285-1298`) does not apply the `ending.branch === tree.branch` guard that `readFreshAgentCandidates` applies (`registryd.ts:860-869`). A `nothing-done` ending left by an earlier branch at the same path can therefore produce `release-claim` for the current branch. The `releaseClaim` refusals still stand in front of it. Neither slice makes this worse. File it separately.

### CLAUDE.md exception wording

"An `OPEN` row may answer only where a wrong answer releases nothing" is too wide, as the fresh-agent case shows. **Amend** it to say that the row may answer only where its only effect is `leave` (no release, no start, no ask), and that the store must be fresher than the stated bound. Name the one consumer.

## 3. The tally fix

- Read: `tally.calls` feeds only `spendForTick` → `boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:401-408`) → the `mine=` field of the tick line (`registryd.ts:587-590`) and the supervision report. No cadence or decision reads it (`git grep`, **ran**). The comment at `registryd-main.ts:2420` states "Reported, never acted on". So the change cannot move a release, a start or the interval.
- Defect: the plan resets `tally.calls` "after the spend reading". Two paths take no reading. The catch path (`registryd-main.ts:2390-2412`) runs `continue`, and an incomplete tick skips `spendForTick` (`:2421`). Host calls on those paths then accumulate into the next reading. `boardSharePerHour` divides by one interval, so `mine=` over-reports after a failed or incomplete tick. Today those calls are dropped. **Amend:** state where the counter resets on a tick with no reading (reset at the same point), or divide by the time since the last reading. Add a test for one incomplete tick followed by a complete one.
- Tests that pin `minePerHour` (`registryd-main.test.ts:1539-1541`, `registryd-tick.test.ts:1101-1159`) pass the value in directly and do not depend on where the reset is (read).

## 4. Slices against Changelog and acceptance

- Each slice ships an observable result. Slice 1 removes the calls and makes `mine=` count them. Slice 2 removes the remaining call for `nothing-done` desks with an open PR.
- Acceptance: `budget.tsv` has no caller field and records one line per `gh` process (#2717). The nothing-done share can therefore be shown only by a `ps` sample or by the `mine=` delta, not by `budget.tsv` alone. A `pr-state` call is one process and one request, so the line count is exact for this step. The acceptance should name the `ps` sample as the method, the way the Motivation does.

## 5. New defects and gaps

- The slice 2 scope and staleness bound above (safety).
- The tally reset on paths with no reading (reporting).
- Layering: the mapping "rows + branch + `at` + now → `true` or ask" is a decision. Put it in the domain as a pure rule with unit tests, next to `rules/pr-index.ts`. Do not put it inline in `registryd-main.ts`.
- Cost: `prIndexRows` calls `host.backend()` (a `plot-host.sh backend` spawn) and reads the file on every call. Read the rows once per tick, not once per candidate.
- No shell change, so `check-shell-lines.sh`, bash 3.2 and `check-decision-count.sh` are not affected (read). Slice 2 edits CLAUDE.md, so it must regenerate `AGENTS.md` (`check-agents-md.sh`). The plan already names this.
