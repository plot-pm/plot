# Safety juror: a-missing-plot-worker-prompt-sh

Position: amend

Lens: what the change can stop, delete, merge, overwrite or misreport, and whether every uncertain case ends in a named refusal.

## Findings

1. **The `--check` exit status cannot be the gate.** `plot-install-prompt.sh --check` exits 3 for four different answers: `absent` (origin/main `skills/plot/scripts/plot-install-prompt.sh:62-64`), `stale` (`:103-106`), `present` (`:108-109`) and `settings-unread` (`:93-94`). `present` is explicitly "not a fault" (`:30-34`). A start path that refuses on exit 3 stops every fleet whose prompt file exists but passes no session flag or no settings flag. That is a false refusal on a working repository, and it stops the fleet. The plan says "on `absent` it refuses" but does not forbid reading the status.

2. **The prompt file is not always `.plot/worker-prompt.sh`.** `resolvePrompt` (`packages/domain/src/rules/prompt.ts:40-54`) answers `declared` with the charter's own prompt when a charter names one, and `.plot/worker-prompt.sh` only as the fallback. `runnerDeps` (`packages/fleet/src/server/entry/worker-loop.ts:2177-2199`) sends the `sdk` runner to `.plot/worker-prompt.md` and then to Plot's shipped `templates/worker-prompt.md`, so on `sdk` a missing `.sh` is harmless. A rule that checks the fixed path `.plot/worker-prompt.sh` therefore (a) refuses an `sdk` repository that runs fine, and (b) passes a repository whose charter names a prompt file that is missing, which is the same unnamed exit 1 this plan fixes. Open Question 2 has an answer in the code: the fallback covers the `sdk` runner only; the `command` runner has none (`worker-loop.ts:1552-1560`).

3. **The refusal must come before the claim.** The issue's harm is the stranded claim, not the failed run. The plan does not say where in the start path the check sits relative to the claim ref push and the worktree creation. A check that runs after the claim leaves the same stranded slice with a better message. Open Question 3 also leaves fleetd's own dispatch optional; under the sprint goal (zero interventions) fleetd's auto-dispatch is the path that runs unattended, so leaving it out leaves the defect on the path that matters.

4. **Slice 2 has a cheaper and safer place to name the file.** `runPrompt` joins the resolved prompt path at `worker-loop.ts:1554` and never checks that it exists. A missing file reaches `boundedRun`, fails, and spends three start retries (`:1810`, `:1825`). A check at `:1557` that ends `unstarted` with a line naming the absolute path refuses at once, before `raiseSliceRuns` (`:1570`) counts a run. The plan instead edits the two retry lines, which still spends three attempts and still ends with "the slice stays claimed".

5. **The claim stays stranded when a worker starts anyway.** Neither slice releases or hands back the claim. After slice 2 the operator reads a better line and still needs `--restart` per branch. The plan should say so in its Changelog, so no reader takes the fix as covering the strand.

6. **Which checkout is read.** `plot-install-prompt.sh` reads `git rev-parse --show-toplevel` of its working directory (`:45`); the loop reads `deps.repoRoot` (`worker-loop.ts:1552`). The start path must read the same root the loop will read, or the two answers disagree across checkouts and a start passes that the worker then fails.

7. Claims checked and true: the two log lines are at `worker-loop.ts:1810` and `:1825` on origin/main; `runnerDeps`'s shipped fallback is at `:2181` per `git grep` on origin/main. `startCommand` (`packages/domain/src/rules/start-command.ts`) is the existing domain rule for start refusals and already names `plot-install-prompt.sh` in a repair; the new rule fits beside it.

## Required amendments

- A. The domain rule takes as readings: the runner (`command` or `sdk`), the resolved prompt (`resolvePrompt`'s answer, including `refused`), and whether that resolved file exists under the root the loop reads. It refuses only for `command` runner + resolved file absent, naming the absolute path and `plot-install-prompt.sh`. It never reads `plot-install-prompt.sh`'s exit status; if the adapter asks that script at all, it matches the word `absent` only.
- B. State that the refusal runs before the claim ref is pushed and before any worktree is made, in every start path, and name fleetd's dispatch as one of them.
- C. Slice 2 adds the existence check at the prompt resolution in `runPrompt` and ends `unstarted` with a named line, so no retry is spent on a file that is absent.
- D. Changelog states that a claim already stranded still needs `plot-dispatch.sh --restart`; this plan does not release claims.
- E. Tests: a fixture with `present`/`stale` prompt passes the start; an `sdk` repository with no `.sh` passes; a charter naming a missing prompt refuses; each fails against the fixed-path design.

## Decisions for a person

- Refuse or warn (Open Question 1). With amendment A, a refusal fires only where every worker would fail, so this juror sees no false refusal left; the choice is still the operator's.

## What I ran versus read

Ran: `gh issue view 2529`; `git show` / `git grep` on origin/main over `worker-loop.ts`, `prompt.ts`, `worker-prompt-text.ts`, `start-command.ts`, `charter.ts`, `plot-install-prompt.sh`, `skills/plot-dispatch/SKILL.md`, `.gitignore`, `.plot/` tree. Read only: the plan. I ran no test, fleet, board or host write.
