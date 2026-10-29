# Juror verdict: layering

Position: amend

Evidence: Read the plan, `DESIGN-delivery-loop.md` (sections *Constraints*, *The loop*, *Stalls*, *Decided*, *Calls made*, *Left to the builder*), issue #2899 (`gh issue view`), the sibling plans #2908–#2917 (grep for run log, attempts, #2899), and in the worktree at `96b0b77a2`: `packages/domain/src/ports/notifier.ts`, `packages/domain/src/rules/question-escalation.ts`, `packages/domain/src/workflows/decision.ts:624-650`, `packages/fleet/src/server/entry/registryd.ts:384-440`, `packages/fleet/src/server/entry/registryd-main.ts:1034-1048,1513-1560`, `packages/fleet/src/shared/escalations.ts`, `packages/domain/src/ports/fresh-agent-record.ts`, `packages/domain/src/rules/task.ts:14,90-91`, `packages/fleet/src/shared/fleet-scan.ts:20`, `packages/fleet/src/server/entry/worker-loop.ts:1850-1870`. Ran: `pnpm --filter @plot-pm/domain exec vitest run test/question-escalation.test.ts` (18/18 pass; 5 cases feed `recordedRungs` as a reading). Ran nothing against the plan's own code, because none exists yet.

## (a) Problem statement

- The motivation matches the design's *Stalls* section (`DESIGN-delivery-loop.md:158-160`) and the issue body. No fact is wrong.
- "the existing `Notifier` port (`ports/notifier`, already used by `registryd` for escalations)" is correct: `ports/notifier.ts:35`, wired at `registryd-main.ts:1046` (`notifierFor`) and applied at `registryd-main.ts:1528` (`notifyEscalations`).
- The plan omits the precedent it most needs. The escalation path already solves "one notification per event, not one per tick": `questionEscalation` takes `recordedRungs` as a reading (`question-escalation.ts:16`) and answers `isNew` (`:52-53`); the applier records every send, `sent`, `unaskable` or `failed <code>`, to `.plot/state/escalations.tsv` (`registryd-main.ts:1540-1551`, `escalations.ts:114`). The plan's stall rule takes only "the run log, the config bound and the current time" (plan, *Stall rule*). Those three readings cannot answer "already notified". With only them, the rule either notifies on every 5 s pulse (`fleet-scan.ts:20`, `REFRESH_MS = 5_000`) or the dedup moves into the controller, which is a decision outside the domain.
- Name collision: `stalled` is already an Agent state (`rules/task.ts:14`, `:90-91` — a dirty or unpushed desk; `transitions/agent.ts:68`; `restart-offer.ts:2`), and CLAUDE.md names it an Agent fact read from the desk. A "stall" rule that means "no loop step past a bound" is a second meaning for one word. CLAUDE.md asks for the field's existing word, and a new term defined once.

## (b) Approach, read against the layering rule and the index rule

1. **Readings as values: correct in shape, incomplete in input.** The stall rule belongs in `packages/domain/src/rules/` as a pure function, as the plan says. Its reading must also carry the stalls already notified. Shape that matches the precedent: `slots: { lastStepAt, recordedStalls: ReadonlySet<StallKey> }`, where a stall key is (slice, kind, episode start). The rule answers `{ stall, isNew }`, as `questionEscalation` does.
2. **The notification is a `Decision` write, not a controller call.** `NotifyWrite` (`decision.ts:640-650`) is desk-question-shaped: `worktree`, `askedAt`, `rung`. The plan must say whether it generalises `NotifyWrite` or adds a sibling kind (for example `stall-notify`) with its own key. Either way the applier records the send, `unaskable` included, as `notifyEscalations` does. Without a record of the send, the dedup has nothing to read after a daemon restart. This repo declares no `Notify command` in its `## Plot Config`, so every send here answers `unaskable` (`ports/notifier.ts:29-33`). The record must still be written, or the board has nothing to show either.
3. **The run log is not an index, and the plan's framing invites a misuse.** The plan says "A line is an answer fleetd bought or a step it took, so the file follows *A Decision Reads The Index*." CLAUDE.md's index holds *bought answers* that cannot be re-derived (`mergedAt`, checks, issue state), and it refuses persisted verdicts ("Answers, never verdicts"). A run-log line is an **action record**, of the same kind as `escalations.tsv`, `fresh-agent-record` and `reap-record`. The risk is concrete: an `outcome` column holding `merged` or `green` is a second copy of a host answer that the PR index already owns. A later loop rule could read PR state from the run log instead of the index. State in the plan: the stall rule reads the run log only for *when* a step happened. No rule reads a host fact (merged, checks, review state) from the run log. Those come from the PR index and the default-branch reading, as the design's *Constraints* bullet 2 requires (`DESIGN-delivery-loop.md:36`).
4. **A "step" must be an action, never an evaluation.** The plan does not define what writes a line. If `slice-pr-next` logs its answer on every pulse, a slice waiting on CI writes 12 lines a minute (5 s pulse). Then the "no step past a bound" stall can never fire, because every evaluation is a step. Define a line as written only when fleetd *acts* (starts an agent, writes a correction, merges, opens a ticket, notifies) or when the rule's answer *changes* for that slice. A `hold` repeated on every tick is not a step.
5. **Port and adapter: name them.** The plan says "an adapter writes the file". The in-domain precedent is `ports/fresh-agent-record.ts:49-71` (`rowsFor`, `append`) with `adapters/fresh-agent-record/fresh-agent-record-file.ts`. The out-of-domain precedent, `fleet/src/shared/escalations.ts`, calls `fs.appendFileSync` directly outside any `adapters/` directory. Choose the first. Then the domain owns a `RunLog` port, and fleetd, the worker loop and later controllers all append through one adapter.
6. **More than one process writes.** The CI correction is written by the desk's worker loop (`worker-loop.ts:1862-1868`), a separate process from fleetd's tick. Later plans add the `continue` controller (#2913) and `plot-ask.mjs merge` (#2914) as writers. The design says "fleetd records" (`:160`). The plan must say whether only fleetd's tick writes, which would lose the desk's correction step, or whether several processes append. If several append, use one `O_APPEND` write per line, each line under `PIPE_BUF`, as `escalations.ts:114` already relies on. The read must also skip a torn or unparseable line, as `parseEscalationLine` does (`escalations.ts:49-54`).
7. **Destructive steps: none here, correctly.** A notification is reversible and changes no slice state. The rule may read non-terminal readings, because nothing destructive flows from it. No host re-ask is needed.
8. **Shell ratchet and spawn ratchet: the claim holds if point 5 is followed.** `notifierCommand` already spawns inside `adapters/` (excluded from the count). Nothing in the plan needs a `plot-*.sh` line.

## (c) Slices

- **Slice 1 has no step to log yet.** `rules/slice-pr-next.ts` does not exist; #2912 and #2914 create it. Today's automatic steps are dispatch (`fleet/src/shared/auto-dispatch.ts`), deliver (`fleet/src/shared/auto-deliver.ts`), the CI correction (`worker-loop.ts`) and the fresh agent (`registryd.ts:1212` area). Slice 1 must name which of these it instruments. Otherwise it ships a port with zero callers, which CLAUDE.md measures as a defect ("`setSprintState` — nine refusals, zero callers").
- **The second stall kind belongs to the attempts owner.** "Spent both fixer attempts on the same finding" needs the per-PR attempts file. #2912 creates that file (its plan, line 38: "a state file under `.plot/state/` that the rule reads"), and #2915 (line 47) says "this plan reads it and adds no second store". Open question 3 proposes reading the finding from the run log. That gives one fact two stores, which #2915 explicitly refuses. Keep only the "no step past a bound" stall here. Move the attempts stall to #2912, as one more arm over the attempts reading, or make it a third slice here that `waits:` on #2912's rule branch.
- **Dependency bookkeeping.** #2917 and #2913 declare they need #2899. #2912, #2914 and #2910 do not, yet the plan's motivation says "Every later loop plan writes its steps to this log". Either those plans add the dependency, or the log's writers are limited to the plans that declare it.
- The slice order (log, then rule) is right, and each slice is one branch.

## (d) Open questions

1. *Name and key for the bound.* Use a duration string parsed like `Question escalation` (`question-escalation.ts:58-80`, units `s m h d`), not hours like `Claim stale after`, so one parser serves both. Avoid the word "stall" (see (a)); for example `Slice idle after: 2h`. A value of `none` disables it, as `QUESTION_ESCALATION_OFF` does.
2. *Count from the last run-log line or from the PR's last push?* From the later of the two. The PR index row carries `updatedAt` and `headSha` (`rules/pr-index.ts:8-26,447`), so a push is a reading the rule may take from the index without a host call. A desk that pushes every ten minutes is not idle, even with no loop step. The rule then takes `max(lastStepAt, prUpdatedAt)`, both as values.
3. *Same finding before the attempts counter exists?* It cannot be answered without a second store. See (c): move it.
4. *Re-notify after the slice moves?* Yes, keyed by episode: the key holds the `lastStepAt` that started the idle period. Then a new step starts a new key with no extra state. This is the `askedAt` half of the escalation key (`escalations.ts:20-21`) applied to a slice.

New questions the plan should carry:

- Which processes write the run log, and with what atomicity (see (b)6)?
- What does the rule answer when the run log is missing or unparseable? By the precedent (`escalations.ts:9-10`), a missing file reads as no records. For a stall rule that would mean "no step ever", so every slice would be idle at once after a deleted file. The rule needs a floor, for example the slice's claim time, or "unknown" must not notify.
- Does the log rotate or get a size bound? At one line per action it stays small; at one line per evaluation it grows by about 17k lines per slice per day.

## (e) Tests

- **Slice 1, domain tier (vitest):** an adapter test for the `RunLog` file adapter, in the shape of `test/action-receipts-file.test.ts`: append, read back by slice, skip a torn line, missing file reads empty. A rule-level test that one evaluation repeated on N ticks produces one line, not N.
- **Slice 1, fleet tier (vitest, named file):** the instrumented existing step (for example auto-deliver) appends exactly one line per action, with an in-memory `RunLog` fixture.
- **Slice 2, domain tier:** a pure table test of the idle rule over readings: no line past the bound → `isNew: true`; the same stall key already recorded → `isNew: false`; a new step after notifying → a new key; a PR push newer than the last line resets the clock; a bound of `none` → no stall. Mirror `test/question-escalation.test.ts`, which already has 5 cases on `recordedRungs`.
- **Slice 2, fleet tier:** the applier records `unaskable` with `notifierNone` and does not re-send on the next tick (a fixture notifier counts calls), as for `notifyEscalations`.

## Amendments

1. Add the already-notified stalls to the rule's readings, and have the applier record every send (`sent`/`unaskable`/`failed <code>`), following `questionEscalation` + `escalations.tsv`.
2. Emit the notification as a `Decision` write (a generalised `NotifyWrite` or a new kind), not a direct `Notifier` call from the controller.
3. Replace "follows *A Decision Reads The Index*" with "an action record, like `escalations.tsv`". State that no rule reads a host fact from it.
4. Define a step as an action or a change of answer, never a per-tick evaluation.
5. Specify a `RunLog` port and file adapter in `packages/domain`, after `fresh-agent-record`. Name every writer process and the append atomicity.
6. Name which existing steps slice 1 instruments, so the port ships with callers.
7. Drop the "same finding twice" stall from this plan, or put it in a third slice that waits on #2912's attempts file. Do not read attempts from the run log.
8. Rename the concept away from `stalled`, which `rules/task.ts:14` already uses for an Agent state.
9. Take the PR index's `updatedAt` as a second reading for "last movement", and say what a missing run log answers.
