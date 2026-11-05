# Layering juror: a-missing-plot-worker-prompt-sh

Position: amend

## Findings

1. **Approach step 1 has the start path ask a shell script, and that contradicts the plan's own layering sentence.** The plan says "The start path asks `plot-install-prompt.sh --check`" and then "The decision ... belongs in `@plot-pm/domain` ... A shell launcher decides nothing." `plot-install-prompt.sh --check` reports `absent`, `stale` and `present` all as exit 3 (`skills/plot/scripts/plot-install-prompt.sh:62-66` and header lines 8-11), so a caller must parse the word, which puts a decision in `plot-dispatch.sh`. The script also checks only the hardcoded `$root/.plot/worker-prompt.sh` (`plot-install-prompt.sh:57`).

2. **A domain rule for this decision already exists, and the plan proposes a second one.** `startCommand` (`packages/domain/src/rules/start-command.ts:54`) already decides whether an agent starts under the configured `Worker command`, already uses `commandRunsScript` to tell whether the command runs the loop, and already names `plot-install-prompt.sh` in its repair (`start-command.ts:63`). `plot-dispatch.sh` asks it through `board/plot-start-command.mjs` (`plot-dispatch.sh:1011-1015`, `:2321`), and its `refused` arm already prints the why and repair and exits 1 (`plot-dispatch.sh:2323-2331`). The slice marker `<!-- builds: a worker-prompt presence rule in the domain -->` names a new rule. Extending `startCommand` with a prompt-file reading gives one decision site and adds about zero shell lines.

3. **The prompt file is not always `.plot/worker-prompt.sh`.** `resolvePrompt` (`packages/domain/src/rules/prompt.ts:40`) returns a charter-declared prompt for an agent with a charter, and `FALLBACK_PROMPT` only otherwise. The loop launches from that resolution (`packages/fleet/src/server/entry/worker-loop.ts:1545-1552`). A start check on the fixed path refuses an estate whose agents all declare their own prompt, and passes one whose charter names a missing file. The reading must be "the resolved prompt file exists", taken by the entry (`plot-start-command.mjs`) and handed to the rule as a value, per "readings as values".

4. **Open question 3 has an answer in the code, and the plan must state it.** fleetd starts agents through `performer-shell.ts:93` (`plot-dispatch.sh --start 1`), and `/plot-fleet --start` reaches the same script. So one check in the `--start` path covers `plot-fleet --start`, fleetd's own starts and `plot-dispatch.sh --start`. `--restart <branch>` calls `startCommand` as `assigned` and needs the same answer, because a missing prompt fails an assigned agent the same way.

5. **Slice 2 changes operator lines, and the better place is the existing launch refusal.** `worker-loop.ts:1550-1552` already refuses to launch with a named line when the resolution yields no file. It does not check that the file exists, so a missing file runs, exits 1, and costs three attempts (`:1810`, `:1814`). An existence reading at that branch ends the run once, with a line that names the path, and no change to the domain's `agent-attempt` arithmetic. The plan names `:1810` "and its sibling" but does not say whether the absence is a reading or a string match on the exit.

6. **Shell growth is unbudgeted.** `scripts/check-shell-lines.sh` refuses growth in shipped shell. Approach 1, as written, adds a `plot-install-prompt.sh` call and a word parse to `plot-dispatch.sh`. The plan does not name the lines it removes in exchange. Finding 2's route needs none.

7. **Index and controllers.** The check reads a local file, so "A Decision Reads The Index" does not apply. No lifecycle action moves, so the controller rule does not apply. The Bitbucket arm is untouched.

8. **The SDK question (open question 2) has a layering answer.** The SDK runner falls back to the shipped `templates/worker-prompt.md` (`worker-loop.ts:2181-2190`). The command runner has no fallback. The rule therefore needs the runner (`Agent runner`) as an input: refuse for `command`, do not refuse for `sdk`. Otherwise the refusal blocks SDK-runner estates that need no `.sh`.

## Required amendments

- Replace "asks `plot-install-prompt.sh --check`" with: `plot-start-command.mjs` reads whether the resolved prompt file exists (through `resolvePrompt`) and the runner, and `startCommand` takes both as values and returns `refused` with a why naming the path and a repair naming `plot-install-prompt.sh`. Change the slice marker to "extends `startCommand`".
- State that the check holds for `plot-dispatch.sh --start` (and so fleetd and `/plot-fleet --start`) and for `--restart`.
- Scope the refusal to the `command` runner; the SDK runner keeps its shipped fallback.
- Slice 2: move the absence into the existing launch refusal at `worker-loop.ts:1550` as an existence reading, so the loop ends after one named line rather than three unnamed attempts.
- State the shell line budget: zero net lines in `plot-dispatch.sh`.
- Name the tests: a `start-command` unit test where an absent file under the `command` runner refuses and fails before the change; a `worker-loop` test where an absent prompt logs the path and makes no attempt.

## Decisions for a person

- Refuse or warn (open question 1). Under finding 8 a refusal only hits a `command`-runner estate with no prompt file, which cannot run at all, so refuse is the consistent answer; a person confirms.

## Ran versus read

Ran: `git show` / `git grep` on `origin/main` over the files cited. Read only: the plan, `CLAUDE.md`. No tests, no host calls, no issue read (`gh issue view 2529` not run; the plan's account of the issue is taken as given).
