# The delivery loop keeps a run log and reports idle slices

> fleetd records one line per delivery-loop action, and a slice PR that stays idle past a bound notifies the person once, without stopping the loop.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2899
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- fleetd writes one line to a run log under the common git dir's `.plot/state/` each time the fleet dispatches a slice, writes a CI correction, starts a fresh agent or delivers a plan.
- A slice PR that takes no loop step for longer than `Slice idle after` (default `2h`) sends one notification through the `Notify command`. A slice that moves and goes idle again sends one more. A notification never stops the loop or changes the slice.
- Every idle notification is recorded in the run log with its send status (`sent`, `unaskable` or `failed <code>`), also in a repository that declares no `Notify command`.

<!-- Board impact: none. The plan format, template and docs/plans layout do not change. The run log is a new file under the common git dir's `.plot/state/`; the board does not read it, and this plan adds no board view of it. -->

## Motivation

The story `the-fleet-delivers-a-scope-alone` removes the master agent from delivery. With no person watching, a slice that stops moving is silent: nothing records what the loop did, and nothing tells the person that a slice is stuck. The design (`DESIGN-delivery-loop.md:158-160`, section *Stalls*) asks for a run log and a notification so that "never stops" does not become "loops silently".

Panel round 1 measured the starting point:

- The `Notifier` port exists (`packages/domain/src/ports/notifier.ts:32-41`). fleetd builds it from `Notify command` (`notifierFor`, `packages/fleet/src/server/entry/registryd-main.ts:1046`) and applies `notify` writes in `notifyEscalations` (`registryd-main.ts:1528`). The file names say `registryd`; the process is fleetd.
- This repository declares no `Notify command` in its `## Plot Config`, so every send here answers `unaskable` (`notifier.ts:27-30`). A notification that is not recorded is invisible on this estate.
- "One notification per stall" needs a record of what was sent. The question ladder already solves this: `questionEscalation` takes `recordedRungs` as a reading and answers `isNew` (`packages/domain/src/rules/question-escalation.ts:16,54`), and the applier records every send with its status (`registryd-main.ts:1536-1552`). The plan copies that pattern, not that file: `escalations.tsv` stays the question ladder's record.
- No loop step from #2900–#2907 exists yet. The steps fleetd takes today are auto-dispatch (`packages/fleet/src/shared/auto-dispatch.ts:159`), the CI correction that the desk's worker loop writes (`packages/fleet/src/server/entry/worker-loop.ts:1862`), a fresh agent start (`packages/fleet/src/server/entry/registryd.ts:1146-1153`) and auto-deliver (`packages/fleet/src/shared/auto-deliver.ts:406`). Slice 1 instruments these, so the port ships with callers.
- `stalled` already names an Agent state: a desk whose work exists only on this machine (`packages/domain/src/rules/task.ts:13-14,90-91`). This plan calls its concept an **idle slice**.
- The earlier draft's second stall kind, "both fixer attempts spent on one finding", reads the attempts record that #2903 owns. Reading the finding from the run log would make a second attempts store. That notification moves to #2903.

This plan depends on no sibling, and no sibling waits on it for the review or the answer: #2900 and #2901 write no run-log line. #2900's review start budget names this plan's idle-slice rule as the only signal a person gets for a head past that budget (`budget-spent`). #2902, #2903, #2904 and #2907 are expected to write their steps to its log.

## Design

### Approach

**Run log.** The domain owns a `RunLog` port (`ports/run-log.ts`, with `append(line)` and `read()`), a file adapter (`adapters/run-log/run-log-file.ts`) and a fixture adapter, in the shape of `ports/fresh-agent-record.ts:62-71`. The file sits under the common git dir's `.plot/state/`, resolved through `git rev-parse --git-common-dir` as `fresh-agent-record-file.ts:16,70` does, so a worktree and the main checkout write one file. One line holds subject (plan and branch), PR, head, step, outcome and time. The line codec escapes tabs and newlines, because an outcome can hold a finding title. A missing file reads as no lines; an unreadable file reads as `failed`; a torn or unparseable line is skipped.

**Step vocabulary.** `step` is a `z.enum` with a `plot-state: classification` declaration for `scripts/check-state-declarations.sh`. This plan defines `dispatch`, `correction`, `fresh-agent`, `deliver` and `notified`. Later plans add their own steps to the same enum. `outcome` is a declared enum too, and it separates a step that moved the slice from a failed or partial host answer.

**A step is an action, never an evaluation.** A line is written only when the loop acts (dispatches, corrects, starts an agent, delivers, notifies) or when the loop's answer for a slice changes. A rule that answers the same thing on every tick writes nothing. Without this rule, a slice that waits on CI writes about 1,440 lines a day at the 60 s tick (`registryd.ts:81`) and never goes idle.

**The run log is an action record, not an index.** It records what the loop did, as `escalations.tsv` and `fresh-agents.tsv` do. No rule reads a host fact (merged, checks, review state) from it; those come from the PR index and the default-branch reading. Only the idle rule reads it, and only for when a step happened. No merge, fixer, restart, revert or attempts decision reads it, because a wrong answer there costs at most one message too many or too few.

**Writers.** Two processes append: the looping fleetd daemon (dispatch, fresh agent, deliver, notified) and the desk's worker loop (correction). Each append is one `O_APPEND` write of one line below `PIPE_BUF`, so lines from two processes never interleave. `plot-fleetd.mjs --once` appends no line and sends no notification, as the socket is the looping daemon's alone (`registryd-main.ts:2543`).

**Idle rule.** A domain rule in `packages/domain/src/rules/` takes readings as values, as `questionEscalation` does:

- the subject set: the open slice PRs in the PR index, with each PR's `createdAt`; a row that reads MERGED or CLOSED leaves the set, so a person who merges or closes a PR by hand causes no notification;
- the run-log lines for those slices;
- fleetd's start time, from `fleetd-start.json`;
- the slices that hold a live `PLOT-BLOCKED` marker;
- the bound and the current time.

A slice's clock starts at the latest of its last line that moved it, its PR's `createdAt` and fleetd's start. A failed or partial host answer does not move the clock. A slice is idle when the clock is older than the bound (strict `>`, as `question-escalation.ts:47`). A slice with a live `PLOT-BLOCKED` marker is never idle: the question ladder and #2901 own that notification, so a blocked desk gets one message, not two. The rule answers `{ idle, isNew }`.

**Notify record.** The rule's readings carry the idle episodes already notified. An episode key is the slice plus its clock start, so a new step starts a new episode with no extra state. A new `Decision` write kind beside `NotifyWrite` (`packages/domain/src/workflows/decision.ts:640-650`) carries the message and the episode key. The applier in `registryd-main.ts`, beside `notifyEscalations`, sends through the `Notifier` port and appends a `notified` line with the status `sent`, `unaskable` or `failed <code>`. Delivery is at least once: a crash between the send and the append sends the message again after the restart. A notifier that throws does not end the tick.

**Bound.** `Slice idle after` is a `## Plot Config` key in the duration grammar of `parseQuestionEscalation` (`question-escalation.ts:96-104`, units `s m h d`); `none` turns the rule off. The default is `2h`, above the design's worst merge-queue wait of about 100 minutes for ten slices (`DESIGN-delivery-loop.md:89`).

**Growth.** One line per action keeps the file small; the existing append-only records on this machine hold 277 lines (`escalations.tsv`) and 208 lines (`endings.jsonl`) with no cap. This plan adds no rotation.

**Layering.** The tick calls the domain rule; the domain owns the port; the adapter writes the file. The plan adds no `spawn` site and no `plot-*.sh` line, so `scripts/check-shell-lines.sh` and the spawn ratchet stay unchanged.

**A head past #2900's review start budget.** #2900 starts at most three reviews per head and then answers `none` with the reason `budget-spent` (`feature/fleetd-reviews-slice-prs`). It writes no run-log line, so its review starts do not move the clock. The slice takes no further loop step, and this rule notifies once when the clock passes `Slice idle after`. This is the only signal a person gets for such a head; this plan adds no budget-specific message.

**Out of this plan.** No board view of the run log. The "both fixer attempts spent on one finding" notification belongs to #2903 (`feature/an-unfixed-high-is-ticketed`), which reads its own attempts record.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-the-delivery-loop-keeps-a-run/panel.md`):

- [x] D2: every HIGH goes to a fixer, two attempts per PR, then the ticket. The attempts record and the "attempts spent on one finding" notification belong to #2903; this plan keeps only the idle rule and never reads attempts from the run log.
- [x] D3: the scope is the active sprint read from git, and #2900 builds its reader (`feature/the-scope-is-read-from-git`). The idle rule takes its subjects from the open slice PRs in the PR index and does not wait on the scope reader.
- [x] D6: fleet records live in `.plot/state/` under the common git dir on the fleet's machine. The run log lives there too.
- [x] The concept is an idle slice, not a stall, because `stalled` is an Agent state (`rules/task.ts:14`).
- [x] The run log is an action record; only the idle rule reads it.
- [x] Slice 1 instruments today's steps: dispatch, correction, fresh agent, deliver.
- [x] A step is an action or a change of answer, never a per-tick evaluation.
- [x] The notify record is a `notified` line in the run log keyed on slice and episode start, written through a new `Decision` write kind; `escalations.tsv` stays the question ladder's.
- [x] The bound is `Slice idle after` in the `Question escalation` duration grammar; `none` turns it off.
- [x] The clock counts from the last moving line, the PR's `createdAt` or fleetd's start, whichever is latest; a failed host answer does not reset it.
- [x] An idle slice re-notifies once per episode.
- [x] Only the looping daemon and the worker loop write; `--once` writes nothing.
- [x] The idle-slice rule is the signal for a head past #2900's review start budget (`budget-spent`). #2900 and #2901 write no run-log line and do not wait on this plan.

### Open Questions

- [ ] Is a `hold` (queued behind one merge in flight, or main red) a step? The moderator's call: it is not, and the `2h` default sits above the expected merge-queue wait. A red main that lasts past the bound then makes every held slice idle at once; #2904 may want one "main red" message to replace them.
- [ ] #2900's review starts write no run-log line, so a slice whose reviews and re-reviews run past `Slice idle after` reads idle while the reviews still run. Is that the wanted signal, or does #2900's review start write a moving line?
- [ ] Can a line name a subject that is not a slice, such as #2904's repair of the default branch or #2907's release PR, or do those plans log elsewhere?

### Tests

- Slice 1, domain: `packages/domain/test/run-log-file.test.ts` in the shape of `fresh-agent-record-file.test.ts`: append and read back, a missing file reads empty, an unreadable file reads `failed`, a torn line is skipped, two appends keep order, a tab or newline in `outcome` round-trips, a worktree and the main checkout resolve one file. The test removes its temp dir by the exact `mkdtempSync` name.
- Slice 1, fleet: each instrumented step appends exactly one line per action against a fixture `RunLog`, and `--once` appends none.
- Slice 2, domain: `packages/domain/test/slice-idle.test.ts` over values: within the bound is not idle; exactly at the bound is not idle; past it is; a slice outside the open set is never idle; a slice with no line counts from `createdAt`; every slice past the bound just after fleetd starts is not idle until the bound passes since the start; only failed-outcome lines past the bound is idle; a live `PLOT-BLOCKED` marker is never idle; a recorded episode answers `isNew: false`; a new step then a second idle period is a new episode; `none` is never idle.
- Slice 2, fleet: one idle slice sends one message across two ticks; an `unaskable` send is recorded; a notifier that throws does not end the tick; the tick's other writes are identical with and without the idle slice.
- Gates: `scripts/check-state-declarations.sh` with the new enums declared, and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`.

## Slices

### Run log

- `feature/the-loop-keeps-a-run-log` — the `RunLog` port, file and fixture adapters under the common git dir's `.plot/state/`, the line type and step vocabulary; dispatch, correction, fresh agent and deliver write their lines <!-- builds: RunLog port and run-log-file adapter, run-log line type and step enum -->

### Idle notification

- `feature/an-idle-slice-notifies` — the idle-slice rule over open slice PRs, the `Slice idle after` key, the notify write kind and its `notified` line; one notification per idle episode <!-- builds: the slice-idle rule, an idle-notify Decision write -->

## Notes

- Created from tracker issue #2899 (plan PR #2909). Only the plan's `Issue:` field links to it; nothing was written to the tracker.
- Section named by the issue: *Stalls*.
- Siblings: #2900 and #2901 write no run-log line and do not need this plan; #2900 names this plan's idle-slice rule as the signal for a head past its review start budget. #2902, #2903, #2904 and #2907 are expected to write their steps to the run log and add their steps to its vocabulary.
- #2903 (`feature/an-unfixed-high-is-ticketed`) owns the "both fixer attempts spent on one finding" notification.
- Amended 2026-10-29 after panel round 1.
