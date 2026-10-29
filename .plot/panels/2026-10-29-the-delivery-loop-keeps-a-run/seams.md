# Juror verdict: seams against the nine sibling plans and the design

Position: amend

Evidence: Read the plan, `DESIGN-delivery-loop.md`, the story's STORY file (line 43), all nine sibling plans (PRs #2908 and #2910–#2917), and the `Needs:` line of issues #2898 and #2900–#2907 (`gh issue view`, read-only). Read `packages/domain/src/ports/notifier.ts`, `workflows/decision.ts:624-651` (`NotifyWrite`), `rules/question-escalation.ts`, `packages/fleet/src/shared/escalations.ts`, `packages/fleet/src/server/entry/registryd.ts:291-436` and `registryd-main.ts:1035-1037`, and grepped every `.plot/state/` path the packages name. Ran `pnpm --filter @plot-pm/domain exec vitest run test/question-escalation.test.ts` in the main checkout (same code as the plan's tree, `96b0b77a2` is the plan commit on main): 18 of 18 passed. Ran no test of the plan's own work, because none exists yet.

## (a) Problem statement

- The plan's facts check out. `ports/notifier.ts` exists, and `registryd.ts:384-421` uses it for escalations through a `NotifyWrite` (`decision.ts:640`). `registryd-main.ts` is the `plot-fleetd.mjs` entry (`registryd-main.ts:155-162`), so "already used by registryd" means "already used by fleetd". The claim is right.
- Missing fact: this repository declares no `Notify command` in its `## Plot Config` (grep of `CLAUDE.md` finds neither `Notify command` nor `Question escalation`). `notifier.ts:26-29` answers `unaskable` for that case. Here, a stall therefore notifies nobody, and the plan's "notifies the person" does not hold on this estate. The plan should say which config line makes the notification reach a person, or what a stall shows when `notify` answers `unaskable`.
- "Every later loop plan writes its steps to this log" (Motivation) is the issue's claim (`#2899: Needs: nothing. Every later loop plan writes its steps here`). The siblings do not carry it: only #2900 and #2901 name #2899 as a need. #2902 (merge), #2903 (fixer, ticket), #2904 (repair, revert), #2906 (fixer start, restart) and #2907 (release) each take loop steps and none says it writes a run-log line.

## (b) Approach, seam by seam

1. **Stall arm 2 depends on a file a later plan owns, and the dependency is circular.** Arm 2 ("spent both fixer attempts on the same finding") needs the per-PR attempts file. #2903 owns that file: *"The attempts counter lives beside the PR index under `.plot/state/` and is written by one place"* (#2903, *Calls made here*). #2906 reads it and *"adds no second store"* (#2906, Open Questions). The chain is #2903 needs #2900 needs #2899 (issue `Needs:` lines). So #2899 cannot wait on #2903, and the plan's Open Question 3 proposes to read the finding "from the run log line's outcome" instead. That is a second attempts store, which contradicts both siblings. **Owner: #2903 owns the attempts file. Arm 2 leaves this plan**: #2903 (or #2906) calls the stall notification that this plan provides when it records the second spent attempt, or a third slice of a later plan adds arm 2 over #2903's file.
2. **The run log has no named write interface, so no sibling can depend on it.** The plan says "an adapter writes the file" (Layering) and names no port, no function and no line type. #2901 says *"The run log comes from #2899"* and proposes writing answers there for a plan with no `Issue:` (#2901, Open Question 2). #2900 lists #2899 as a need. Both need a concrete name. **Owner: this plan.** It should name the port (for example `ports/run-log.ts` with `append(line)` and `read()`), the domain line type, and the `step` vocabulary (`dispatch`, `correction`, `fresh-agent`, `review-start`, `merge`, `hold`, `fixer-start`, `restart`, `unblocker-answer`, `deliver`, ...). The other plans then add steps to that vocabulary rather than invent their own.
3. **Stall arm 1 misfires unless every step writes a line, and the plan does not say whether a hold is a step.** The design's merge rule holds every slice while one merge is in flight (*One merge in flight*: up to about 100 minutes for ten slices). If a `hold` writes a line on each tick, no held slice ever stalls, and a slice that is stuck in a hold forever never notifies. If a `hold` writes nothing, every queued slice notifies once the queue is longer than the bound. And while #2902, #2903, #2904, #2906 and #2907 write no lines (point (a)), a slice whose only recent steps are merges or fixer starts reads as stalled. The plan must decide this, because the stall rule's meaning depends on it.
4. **Overlap with the question-escalation ladder.** A desk with an unanswered `PLOT-BLOCKED` takes no step, so arm 1 fires. The existing ladder (`question-escalation.ts`, `registryd.ts:384-421`, `escalations.tsv`) also notifies for the same desk. That gives two messages for one cause. #2901 turns `escalations.tsv` into "a record only" (#2901, slice *Record*) and proposes that a third question on one slice "notifies a person ... This is a stall notification" (#2901, Open Question 1). That is a third stall kind this plan does not build. **Owner of the stall vocabulary: this plan.** It should either add a `question` stall kind that replaces the ladder's notification, or exclude a desk with a live marker from arm 1 and leave the ladder to #2901. Either way, the plan should say which.
5. **"Once per stall episode" needs a record, and a precedent exists.** The plan sends "one notification per stall, not one per tick", but names no file that remembers the sent notification. `escalations.tsv` and `NotifyWrite` already do this for questions, keyed by worktree and `askedAt`, with the send result in a `status` column (`escalations.ts:6-31`, `decision.ts:633-638`). The stall record should use the same shape and be applied in `registryd-main.ts` beside the escalation `notify` write, not by a new route. #2907 needs the same dedupe for its release message ("sent once per head"). A single notify record that this plan owns would also serve #2907.
6. **Caller identity and the review record do not touch this plan.** The design uses fleetd's caller identity for `continue`, `restart` and `merge` (owner #2898, slice `feature/fleetd-caller-identity`). This plan calls no controller, so it does not need that identity. The plan never names the review record. The "same finding" in arm 2 still needs a finding identity, and no sibling defines one: #2900 owns the review record and gives the findings no id. If arm 2 stays anywhere, #2900 must define a stable finding key.
7. **`rules/slice-pr-next.ts`**: this plan does not touch it, which is correct. #2900 introduces it, and #2902 and #2903 add arms. The run log should record that rule's answer per slice per tick, and the step vocabulary in point 2 should therefore use the rule's answer names.
8. **Layering and shell ratchet**: the plan is consistent with both. The rule takes readings as values, the same pattern as `questionEscalation` (`question-escalation.ts:8-17`). No shell is added.

## (c) Slices

- Slice 1 builds a writer with no caller. Today's loop steps exist (`auto-dispatch.ts:159`, `worker-loop.ts:1862` corrections, `rules/fresh-agent.ts`, `auto-deliver.ts:406`, per the design's *What exists today*), and slice 1 should write their lines. Without them, slice 2's rule reads an empty log until #2900 merges, and arm 1 cannot be tested against real steps.
- Slice 2 should hold arm 1 only, plus the notify record. Move arm 2 per point 1.
- The plan's `waits:` within itself is right. The seam it lacks is outward: every sibling that takes a step should name #2899 as a need (#2902, #2903, #2904, #2906, #2907). Those sibling plans should get the amendment, and this plan should list them in Notes as the line writers it expects.

## (d) Open questions

- **Q1 key name**: `Stall after`, in hours, is distinct from `Claim stale after` (24, claim liveness) and from #2904's `Main repair bound` (minutes). #2906 proposes to reuse `Claim stale after` for its restart bound, so a separate key keeps the meanings apart. The value must be longer than the worst merge-queue wait if a hold writes no line (point 3).
- **Q2 count from**: count from the last run-log line of the slice. A PR's last push is a host answer the log does not hold, and a slice with no PR (a dead desk, #2906's restart arm) has no push to read.
- **Q3 same finding**: this plan cannot answer it without a second store. Move arm 2 (point 1).
- **Q4 re-notify**: yes, once per episode. Key the record by slice plus the time of the last step before the stall, the same way `escalations.tsv` keys a question by `askedAt`. A new step starts a new key.
- **New: hold lines.** Does a `hold` write a line, and does it reset the stall clock? (point 3)
- **New: no Notify command.** What happens on this estate, which declares none? (point (a))
- **New: question stalls.** Does the stall rule replace or exclude the question ladder? (point 4)
- **New: non-slice subjects.** #2904's repair and #2907's release are not slices. Does the line format allow a subject that is the default branch or a release PR, or do those plans log elsewhere?
- **New: growth.** A line per slice per tick (if holds are logged) grows without bound. Who trims the file?

## (e) Tests

- Slice 1: a unit test that encodes and parses one line (the `escalations.ts` encode/parse pair is the model), and that a missing or broken file reads as no lines. A fleet-package test then shows that one `--once` tick with a dispatched slice writes one `dispatch` line. If `step` is a `z.enum`, it needs a `plot-state:` declaration (`scripts/check-state-declarations.sh`), probably `classification`.
- Slice 2: domain unit tests over values, in the same form as `test/question-escalation.test.ts`: no line within the bound gives no stall, a line older than the bound gives a stall, a recorded notification for this episode gives no new stall, and a new line after the notification followed by a second quiet period gives a new stall. One fleet test then shows that a stall produces one `notify` write and that a second tick produces none.

## Amendments

1. Remove stall arm 2 from this plan. #2903 owns the attempts file. The arm moves to #2903, or to a later slice that waits on #2903. Drop Open Question 3's run-log reading of the finding.
2. Name the run-log port, its line type and its initial `step` vocabulary in this plan, so siblings can depend on a name.
3. Make slice 1 write the lines for today's steps (dispatch, correction, fresh agent, deliver).
4. Decide whether a `hold` writes a line, and set the bound against the merge-queue wait.
5. Name the notify record (reuse the `escalations.tsv` / `NotifyWrite` shape and route) that makes "one per episode" hold. Offer it to #2907.
6. State how the stall rule relates to the question ladder and to #2901's proposed "third question" notification.
7. State the behaviour when `Notify command` is absent, as on this estate.
8. In Notes, list #2902, #2903, #2904, #2906 and #2907 as plans expected to write run-log lines, and amend those plans to name #2899 as a need.
