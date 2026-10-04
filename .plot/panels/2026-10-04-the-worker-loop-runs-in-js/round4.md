# Round 4 — Moderation

**Subject:** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `547816537`
**Lenses:** estate, contradiction, deliverable, cost
**Gate:** each verdict checked with `plot-panel.mjs check Position "proceed,amend,reject" <lens>`; all four exit 0
**Reconcile:** `unanimous	amend	estate,contradiction,deliverable,cost`

## The rubric's new question

Round 3 named a convergence problem: each amendment answered findings with more code-level detail, and each detail became a new claim to check. Round 4 added a third question to the rubric: which claims belong in the slices' briefs, and which must the plan keep because a decision depends on them. All four lenses answered it, and they agree.

- **The plan keeps:** the table's readings, decisions and endings; what changes from today; the three counts; the CI wait's equality rule; the index exception; the one-writer rule; the process-group rule; the launcher's two modes; the restart conditions; slice 6's thresholds; and the dated Motivation measurements.
- **The briefs carry:** every `plot-worker-loop.sh` line number, the write table's starting points, the test-line lists, slice 7's reference sites, and the shell-ratchet arithmetic.
- **Contradiction's test for each claim:** it stays in the plan if an approver would decide differently were it false. It moves to the brief if only the implementer would act differently.
- **Deliverable's replacement for slice 7's list:** one `git grep` acceptance check.

The amendment applies the split. The plan now holds no file:line citation.

## Round-3 findings

| Lens | Answered | Partly answered | Not answered |
|---|---|---|---|
| estate | 12 of 14, and the three citation fixes | 2: `performer`'s contract, the write table | none |
| contradiction | 4 | 2: the `agentState` PR split in two rows, an unnamed port behind `process-exec.ts` | none |
| deliverable | 1 | 4: what the shell does after a moved tip, the slice-1 offset, kinds 4 and 5, the "by desk" cells | 1: the switch for the `js` test leg |
| cost | 3 | 2: the baseline has no collector, no offset line is named | none |

## New findings, by subject

**1. The state column names a value the rule cannot return (estate 1, contradiction 3, deliverable 1).** `deskState` has no `none`. A live free loop reads `working`, and a desk without a manifest reads `unplaced`. Three lenses found it in the same rows.

**2. The ports the plan names contradict their own contracts, and nothing carries out the writes (estate 4, 5, 6; contradiction 5).**
- `performer` starts detached processes that outlive the caller, which is the opposite of `runBounded`.
- No code on `main` carries out `agent-resume`, `agent-attempt`, `blocked-marker`, `commit`, `push` or `worker-signal`. The plan named no piece that turns a `Write` into a port call.
- No write kind carried `correctionAttempts`.
- `trees` already reads a checkout's status. The new tip reading sits beside two local reads, and the plan did not say why it is new.

**3. The #1246 fix lands on a supervisor rule the plan did not read (contradiction 6).** `supervise` reads neither the ending nor the marker. A `holding-work` desk with no `blocked` declaration gets `correct`. Cost found that no performer carries out the retry today, so in practice the desk waits.

**4. More rows change today's behaviour than the plan said (contradiction 1, 2; estate 2, 3, 7).**
- Today the shell loop goes free after any CI-wait verdict and after an agent-written marker.
- The `unstarted` and `limited` rows write a marker today, and the table left it out.
- Row 79 moved the desk reset before the free wait.
- Using `bound` for an expired free wait merged two endings that a test keeps apart.
- The #1250 mechanism is the dispatch wrapper's `clear`/`gone` line, not the supervisor.

**5. An unreadable tip ends the wait (contradiction 4, cost 2).** Under equality, a failed `git ls-remote` reads as a moved tip. At a 60 s poll, that exposure repeats up to 60 times per wait.

**6. The restart never fires from a claimed or continued desk (cost 1).** On those desks the commit the loop loaded from is a slice commit, and squash-merge never puts it on main. Cost measured the one live desk: `free-9172bc8c` at `83779b67e` is not an ancestor of `origin/main`.

**7. The `js` test leg and the baseline cannot run as written (deliverable 2, 3; cost 2, 3, 4).**
- 10 of the 30 loop test files write no config.
- 7 test files and `corpus/production.ts` source the shell body, so they cannot run on `js`.
- Slice 7's removal list missed them.
- The baseline had no collector, and each loop end overwrites the ending file.
- The CI queue cost was not counted.

**8. One index reading was not declared (contradiction 7).** The PR-open reading is a non-terminal host answer, and the exception named only the build calls.

**9. The plan claimed one outcome for slice 1 and allowed two (deliverable 4).** The tip half could move to slice 4, but the Changelog said it shipped in slice 1.

**Disagreements:** none on position, and none on the split. On finding 3, contradiction read `supervise`'s answer as a contradiction of "the board names a person". Cost read the registry daemon and found that the retry is never carried out. Both readings hold. The amendment states both, changes no rule, and drops "names a person" from the Changelog.

## What the amendment decided

- **Slice 1 ships `holding-work` only.** The tip reading moves to the JS loop. That settles finding 9, removes the per-poll network call from the shell, and makes slice 1 easier to split into its own plan.
- **The tip reading answers in three values.** An unreadable tip keeps the wait going, because a failure to observe is not evidence.
- **The loop has its own write kinds.** The supervisor's kinds stay the supervisor's. `performLoopWrites` carries them out with an exhaustive `switch`.
- **New ports.** `boundedRun` and `reexec` are their own ports. `performer` and `processes` keep their contracts.
- **The table's last column** is "who acts next", and slice 2's test derives the state names through the four rules.
- **The loaded commit** is the main checkout's `HEAD` at pin time. The first check compares only the hashes.
- **The baseline.** `write_ending` appends each ending to `.plot/state/endings.jsonl` in the main checkout, and the operator collects the rest daily.

## What the four lenses had in common

The split answers the convergence problem, and round 4 is the test of it. Round 4 found as many problems as round 3. Unlike round 3, most of them were not stale citations. They were missing rules: the supervisor's answer, the unreadable tip, the loaded commit, the interpreter for the writes. Those are the findings a plan review exists for. The plan now holds no file:line citation, so a fifth round checks decisions only.

What no lens asked: the plan has grown from 4 slices to 7, and from about 3 new ports to 6. No juror asked whether slices 3 to 5 are one deliverable that a reviewer can check, or three. Slice 3 now holds an interpreter, three ports and a process-group test. That is the largest slice, and it ships nothing a user sees.

## Outcome

Amend. The amended plan answers every finding above. Each answer is recorded in the plan.
