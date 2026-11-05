# Testability juror — a-missing-plot-worker-prompt-sh

Position: amend

## Findings

1. **The plan names no test.** It has no `## Tests` or acceptance list. Rubric question 6 ("does each named test fail before and pass after") has nothing to check. The seams for such tests already exist on origin/main, so the omission is cheap to fix.

2. **The start decision already has a pure domain rule and a pure test.** `packages/domain/src/rules/start-command.ts` (`startCommand(configured, loop, agent)`) answers `run | unconfigured | declined | refused`, and `packages/domain/test/start-command.test.ts` tests it without a process. `plot-dispatch.sh:1010` (`ask_start_command`) asks it through `board/plot-start-command.mjs`, at `:1100` (per-branch start) and `:2326` (`--start`). The plan says "a rule over a reading of the file" but names neither the rule file nor the reading's shape. An unattended agent can add a second rule beside `startCommand` or extend it; the plan must choose, because the choice decides which test file proves it.

3. **The rule must take a reading, not read the file.** Per CLAUDE.md "A note on shape", the rule takes readings as values. The reading is: the resolved prompt path (`resolvePrompt` in `packages/domain/src/rules/prompt.ts:40` can answer a charter-declared prompt, not only `FALLBACK_PROMPT`) plus a present/absent flag, plus the runner (`command` or `sdk`). The plan names only `.plot/worker-prompt.sh`. A test written from the plan alone misses the charter-declared prompt case and the SDK case.

4. **Open Question 2 changes the test matrix and is unresolved.** `worker-loop.ts:2179-2188` falls back to Plot's shipped `templates/worker-prompt.md` on the SDK runner, and `worker-loop.ts:1548` only refuses an empty path when `sdk === undefined`. So "absent prompt" is a failure only on the command runner. Without an answer, no test can state the expected outcome for `runner = sdk, prompt absent`.

5. **`plot-fleet --start` passed because its write probe counts an unrunnable prompt as unanswerable.** `plot-fleetctl.sh:1135-1150` (REFUSAL 5) runs `plot-write-probe.mjs`, and the comment says it "exits 0 for an unanswerable probe". The plan does not name this path. A slice that adds the check only to `plot-dispatch.sh` leaves `/plot-fleet --start` passing, and no test would catch it. The amendment must name `plot-fleetctl.sh` start (beside REFUSAL 5, before `launchctl bootstrap`) or state that `--start` reaches the check through `plot-dispatch.sh --start` (the dry-run line names that call) and prove the refusal fires before the unit is loaded.

6. **The failure-line slice has a direct, isolated test seam.** `packages/fleet/test/unit/worker-loop-run.test.ts:440-447` asserts the two exact lines through injected `deps.log` and `deps.resolvePrompt`, with no real fleet, launchd or port. That test asserts the current text with `toContain` of the whole string, so it fails after the change unless the slice updates it. The plan does not say so. The new arm (file absent → line names the file) needs its own case there; the existing case (file present, exit 1) must keep the unnamed wording, which also needs a fixture where the prompt file exists. The loop has no existence reading today (`worker-loop.ts:1547` joins the path and never stats it), so the slice must add one as an injectable dep or a reading, or the test cannot vary it.

7. **Isolation of the shell tests is already solved.** `test/reconcile/fleetctl.test.mjs:12-33` refuses any call that reaches the real `launchctl`, and `test/reconcile/dispatch.test.mjs` exercises `ask_start_command` in sandbox repos. Neither touches port 7777. The amendment only has to name these files so the slice extends them rather than writing a new harness.

## Amendments required

A. Add a `## Tests` section naming, for each slice, the test file and the case, each stated as fails-before / passes-after:
   - `packages/domain/test/start-command.test.ts` (or a new `prompt-presence.test.ts` beside the new rule): `command` runner + resolved prompt absent → refused, why names the path and `plot-install-prompt.sh`; prompt present → run; `sdk` runner + absent → run (if OQ2 says so); `Worker command: none` and a command that does not run the loop → not asked; charter-declared prompt absent → refused naming the charter's path.
   - `test/reconcile/dispatch.test.mjs`: `plot-dispatch.sh --start` in a sandbox repo with no `.plot/worker-prompt.sh` exits non-zero, prints the named refusal, and creates no worktree and pushes no claim ref.
   - `test/reconcile/fleetctl.test.mjs`: `--start` with the prompt absent refuses before any init-system call (the stub records no bootstrap).
   - `packages/fleet/test/unit/worker-loop-run.test.ts`: update the row-7 case to a fixture where the prompt exists; add a case where the prompt reading is absent and both lines name the file.
B. Name the rule's home and signature: extend `startCommand` or add `rules/prompt-presence.ts` taking `{ runner, prompt: string, present: boolean }`. No file read in the domain.
C. Resolve OQ1 to refuse (warn produces no assertable outcome a gate can hold, and the sprint goal is zero interventions) or state what the warn line is and where it is asserted.
D. Resolve OQ2 and OQ3 before approval, and list `plot-fleetctl.sh` start as a named start path.

## Decisions that need a person

- OQ1 refuse versus warn. OQ2 whether the SDK fallback exempts the check. OQ3 whether fleetd's own dispatch (fleet package) counts; if yes, it needs its own named test in `packages/fleet/test/unit/`.

## What I ran versus read

Ran: `gh issue view 2529`; `git show origin/main:` and `git grep` over `worker-loop.ts`, `plot-install-prompt.sh`, `prompt.ts`, `start-command.ts`, `plot-dispatch.sh`, `plot-fleetctl.sh`, `worker-loop-run.test.ts`, `fleetctl.test.mjs`. Ran no test and no fleet, board or host write. The claim that the write probe passes on an absent prompt is read from the comment at `plot-fleetctl.sh:1142`, not executed.
