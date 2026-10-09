# A slice whose brief is being written shows nothing on the board

> While a brief writer runs for a slice, that slice sits in NOT STARTED with a working indicator, and only that slice; the indicator ends when the brief lands.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1417
- **Sprint:** the-release-train-fixes-what-it-found
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `feature/the-brief-ask-names-its-branch`
- **Started:** 2026-10-09, jwloka, `feature/the-brief-ask-names-its-branch`

## Changelog

- A slice whose brief is being written shows a working indicator in NOT STARTED for as long as the writer runs, and its sibling slices do not. The indicator ends when the brief lands on the default branch; a writer that failed shows its failure and its log.

<!-- Board impact: the fleet payload gains a per-row "brief writer running" reading, and the implement route's state records the branch it briefs. No change to the plan format, the plan template or the docs/plans layout. The board artifact is rebuilt by main after merge. -->

## Motivation

`a-slice-shows-that-its-brief-was-asked-for` (2.17.0, #905) and `a-brief-the-fleet-writes-shows-as-asked` (v2.24.0, #1272) put a text line "brief asked `<age>` ago" on a row, from the payload field `briefAskedAt`, and a failed writer shows `briefFailed`. `BriefLine` (`packages/board/src/app/lib/agent-rows/rows.tsx:1565`) renders only where `needsBrief(row)` is true, and `briefNote` (`row-identity.ts:296`) chooses the text.

The operator reported on 2026-10-09 that while the fleet wrote briefs for `the-fleet-runs-without-the-board` and `the-shell-sheds-its-decisions`, the board showed neither an indicator nor text for the slices being briefed. Measured 2026-10-09 ~08:40 UTC, `/api/fleet` carried `briefAskedAt` = 01:03 UTC on all four NOT STARTED slices of `the-fleet-runs-without-the-board`, hours after that brief run ended. So the reading is wrong in both directions: absent while a writer runs, and present on four siblings long after it stopped.

Two causes are known:

- **The ask is keyed per plan.** The implement route's log and state, `.worktrees/plot-implement-<plan-slug>.{log,state}`, record no branch. The #1272 plan names this limit in its Notes: one `--brief-only` run marks every brief-less sibling slice.
- **The reading is an age, by design.** `brief-ask-log.ts` reads mtimes and states in its header that it never asks whether a writer is still running. An age cannot end, so it cannot be an indicator.

## Design

### Approach

**"Running" is read from the writer's process.** The implement route already writes `running <pid>` into its state file before a run (`board-run.ts:138`), and `readRunState` (`board-run.ts:295`) checks that pid with `alive`. This plan uses that reading for the indicator: a brief writer is running while its state file holds `running <pid>` and that pid is alive. An age stays what it is today, a note beside the indicator, and never decides it. This reverses the #905 decision against reading a process only for the indicator, because the issue asks for "runs" read from the process and the pid check already exists and is tested.

**The ask records its branch.** A `--brief-only` run writes the branch it briefs into its state, or into a per-branch state file beside the plan-keyed one. The reading then attributes the run to that branch only. A run that names no branch, for example a full `/plot-implement` without `--brief-only`, keeps today's per-plan reading, so the change narrows the reading and never widens it. Which file shape carries the branch is decided in the first slice, from where `startImplement` and the dispatch controller know the branch.

**The state is a domain property.** A rule in `@plot-pm/domain` takes readings as values — the brief's presence on the default branch, the writer's run state and branch, the ask's time — and answers one of `writing`, `failed`, `asked`, or `none` for a slice. `writing` holds only while the writer's process runs for that branch and the brief is absent. Once the brief lands, `needsBrief` is false and the answer is `none`. The board's `fleet.ts` passes the readings in, and `briefNote` and `BriefLine` read the answer. Unit tests assert every answer without a browser; one browser test shows the indicator renders on a NOT STARTED row.

**The slice is in NOT STARTED while its brief is written.** If the measurement below finds a row missing or placed in another section, the first slice fixes that placement in the same domain property, not in `.tsx`.

### Open Questions

- [ ] Where did `briefAskedAt` = 01:03 UTC come from? Measured 2026-10-09 ~10:30 on the main checkout: `.worktrees/plot-implement-the-fleet-runs-without-the-board.state` holds `0`, and `briefReading` does not count a run that recorded `0`. No `.plot/brief-<branch>.log` or `.plot-brief-the-fleet-runs-without-the-board.log` exists for the four slices. Either the board serving `/api/fleet` ran older code, or a fourth asker writes elsewhere. The first slice measures this before it changes the reading.
- [ ] Which condition hid the note while a writer ran: `needsBrief` false, the row in another section, or no row before the slice appears? Not yet measured.
- [ ] A writer started by the fleet supervisor rather than the board: does it write the same state file with its own pid? If not, the process reading needs the supervisor's record too.

## Slices

### The ask names its branch

- `feature/the-brief-ask-names-its-branch` — a `--brief-only` run records the branch it briefs, and the brief reading attributes a running or failed writer to that branch only; measures the 01:03 source and the hidden-note condition first <!-- builds: a per-branch brief writer reading in brief-ask-log.ts --> → #1424

### The row shows the writer

- `feature/the-row-shows-the-brief-writer` — a domain rule answers `writing`/`failed`/`asked`/`none` for a slice from readings, the fleet payload carries it, and a NOT STARTED row shows a working indicator while the answer is `writing`, with one browser test <!-- builds: briefWriterState, a domain rule in @plot-pm/domain -->

## Notes

- 2026-10-09, from issue #1417, created unattended by `/plot-idea`. Type `feature` was given in the request. Review `in-session` and Impl `own branches` follow the precedent of the other issue-sourced plans on this estate (#1404, #1406, #1407).
- Deliverable search, 2026-10-09: `briefWriting` and "brief writer pid" find no existing artifact by that name. The pid check this plan reuses is `readRunState` in `packages/board/src/server/board-run.ts`.
