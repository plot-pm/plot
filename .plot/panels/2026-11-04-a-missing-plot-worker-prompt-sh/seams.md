# Seams juror: a-missing-plot-worker-prompt-sh

Position: amend

## Summary

The defect is real and the two-slice split is right. The plan does not name the seam that already exists for its first slice: the domain rule `startCommand` and its entry `plot-start-command.mjs`, which every start path already asks. It also hard-codes `.plot/worker-prompt.sh` where the domain already resolves a per-agent prompt and a per-agent runner. Without those names, an unattended agent can build a second, parallel rule and edit `plot-fleetctl.sh`, which two other open plans also change.

## Findings

1. **An existing rule decides "can this agent start", and the plan does not name it.** `packages/domain/src/rules/start-command.ts:53` (`startCommand`) already refuses a free agent whose `Worker command` does not run the loop, and its repair already names `plot-install-prompt.sh` (`:63`). `plot-dispatch.sh:1012` (`ask_start_command`) asks it through `board/plot-start-command.mjs` for every start (`:1100`). The plan's slice says "builds: a worker-prompt presence rule in the domain". That wording lets the agent write a second rule beside `startCommand` and a second shell call beside `ask_start_command`. The second shell call costs lines under `scripts/check-shell-lines.sh`, and the plan does not mention the ratchet.

2. **One seam covers three of the four start paths in Open Question 3.** `plot-fleetctl.sh:17-18` brings agents up "through `plot-dispatch.sh --start`". `packages/fleet/src/server/entry/dispatch-command.ts:28,52` starts `plot-dispatch.sh` through the `Scripts` port. So `/plot-fleet --start`, `plot-dispatch.sh --start` and the dispatch controller all reach `ask_start_command`. `--once` runs one supervisor tick and starts agents only through the same path. The answer to Open Question 3 is therefore "extend `startCommand`; change no caller". The plan leaves it open, and an agent that answers it by editing `plot-fleetctl.sh` collides with active plan `plot-fleetctl-stop-ignores-dry-run` (Started 2026-11-04, same file, parser lines `:764-:795`) and with plan PR #3128 (`a-second-mode-flag-in-plot`, same parser).

3. **The prompt file is not always `.plot/worker-prompt.sh`.** `packages/domain/src/rules/prompt.ts:40` (`resolvePrompt`) returns a charter's own prompt for a declared agent and `FALLBACK_PROMPT` only for an unnamed or uncharted agent. `plot-dispatch.sh:933-934` already asks `plot-prompt.mjs --launch` per agent. A presence check on the fixed path refuses a chartered agent whose `.plot/prompts/<name>.sh` exists, and passes one whose declared prompt is absent. The plan names only the fixed path, in the title, the changelog and the approach.

4. **The runner decides whether the `.sh` file is needed, and the plan treats that as an open question.** `worker-loop.ts:2168-2182` (`runnerDeps`, `runnerChoice`) runs the SDK runner on `Agent runner: sdk` or a charter harness, and that runner reads `.plot/worker-prompt.md` or Plot's shipped `templates/worker-prompt.md`. Only the `command` runner sources the `.sh` file (`worker-loop.ts:1545-1551`). Open Question 2 is answered by the code: the fallback does not reach the command runner, and a refusal must not fire for an SDK-run agent. The rule needs the runner choice as a reading.

5. **Slice 2 has a closer site than the log lines.** `worker-loop.ts:1549-1551` already refuses `refusing to launch — <why>` when the resolution names no file. The resolved path `file` is in hand there, and an existence check at that point names the path before any spawn. The log lines at `:1810` and `:1814` (line claims verified on `origin/main`) only describe an exit status. A third surface also omits the file: the `PLOT-BLOCKED` question in `packages/domain/src/workflows/agent-loop.ts:784` and the ending detail at `:790`, which is what the person reads after the third attempt. The plan names neither.

6. **The existing tests assert the current text.** `packages/fleet/test/unit/worker-loop-run.test.ts:446-447` and `worker-loop-sdk.test.ts:427` assert the two lines. Slice 2 changes them; the plan names no test for either slice.

7. **Second reader of the same file.** `packages/domain/src/adapters/write-probe/write-probe-shell.ts:86` reads `FALLBACK_PROMPT` and answers `unaskable: no prompt file to probe` when it is absent. A new presence reading should share the path resolution with it, or the two drift when charters are involved.

8. **No collision with open PRs, and no corpus pair.** No open PR in `gh pr list` (#3076 to #3135) changes `worker-loop.ts`, `start-command.ts`, `plot-start-command`, `prompt.ts` or `plot-dispatch.sh`. No corpus test in `packages/domain/corpus/` pairs `startCommand` or the loop lines with a shell copy, and `plot-worker-loop.sh` is an 18-line launcher, so no declared duplicate is at stake.

## Required amendments

1. Slice 1 extends `startCommand` (`packages/domain/src/rules/start-command.ts`) with a prompt reading, and `plot-start-command.mjs` supplies it. Name both files, and state that `plot-fleetctl.sh` does not change, so the slice does not collide with `plot-fleetctl-stop-ignores-dry-run` or #3128.
2. The reading is per agent: the prompt path from `resolvePrompt` (as `plot-prompt.mjs --launch` answers it) and the runner from `runnerChoice`. A refusal fires only for the `command` runner and only when the resolved file is absent. Close Open Questions 2 and 3 with these answers.
3. Name the shell-lines ratchet: the `ask_start_command` change in `plot-dispatch.sh` either adds no lines or removes an equal number in the same slice.
4. Slice 2 adds the existence check at `worker-loop.ts:1549` (the `refusing to launch` site) and names the resolved path there, and names the file in the `PLOT-BLOCKED` question at `agent-loop.ts:784`. Name the tests that change: `worker-loop-run.test.ts:446-447`, and a new `start-command` unit case per arm (absent on command runner refuses; absent on SDK runner runs; chartered prompt present runs).

## Decisions that need a person

- Open Question 1 (refuse or warn). A `Worker command` that runs the loop always sources the resolved prompt on the command runner, so a refusal there stops no working repository. A person confirms that a `Worker command` which does not run the loop is out of scope.

## What I ran versus read

Ran: `git show`/`git grep` on `origin/main` for `start-command.ts`, `prompt.ts`, `worker-loop.ts`, `write-probe-shell.ts`, `plot-dispatch.sh`, `plot-fleetctl.sh`, `entry/prompt.ts`, `entry/start-command.ts`; `gh pr list`, `gh pr view --json files` for 13 open PRs, `gh pr view 3128`, `gh issue view 2529`; `ls docs/plans/active/` and `packages/domain/corpus/`. Read only: the active plan `plot-fleetctl-stop-ignores-dry-run.md` head. No tests, host writes, board or fleet commands.
