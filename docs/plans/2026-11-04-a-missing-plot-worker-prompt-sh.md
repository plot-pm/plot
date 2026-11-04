# A missing .plot/worker-prompt.sh is named, not an unnamed exit 1

> A repository with a `Worker command` and no `.plot/worker-prompt.sh` fails every worker with an unnamed exit 1 and strands the claim. The start path checks for the file, and the worker's failure line names it.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #2529
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-dispatch.sh --start`, `/plot-fleet --start` and fleetd's own agent starts refuse when the agent runs on the `command` runner and its resolved prompt file is absent. The refusal names the file and `plot-install-prompt.sh`, and it runs before any desk is cut or any agent exists to take a claim. An agent on the `sdk` runner is not refused, because that runner falls back to Plot's shipped `templates/worker-prompt.md`.
- The worker loop checks that the resolved prompt file exists before it launches. An absent file ends the run after one line that names the file, with no start retries, and the `PLOT-BLOCKED` question names the file.
- A claim stranded before this fix still needs `plot-dispatch.sh --restart <branch>`. This plan releases no claim.

Board impact: none. No change to the plan format, the template, the `docs/plans` layout, the board's routes or its types.

## Motivation

Measured on issue #2529 (Plot 2.28.0, quatico-solutions/agent-skills, 2026-10-23): a repository with `Worker command` set and no `.plot/worker-prompt.sh` failed both approved slices with `the command exited 1 without the agent doing any work`, three attempts each. Neither line names the missing file. The slice stays claimed with no agent, the supervisor reports `claim with no agent`, and `plot-dispatch.sh --release` refuses once anything else lands on the branch, so recovery took `--restart` per branch.

`/plot-fleet --start` and `--once` both passed beforehand. `plot-install-prompt.sh --check` reports `absent`, and nothing in the start path asks it. The write probe in `/plot-fleet --start` answers `unaskable` for an absent prompt and exits 0 (`plot-fleetctl.sh:1141-1142`, `write-probe-shell.ts:85-86`), so it does not stop the start either.

## Design

### Approach

Two changes, one per failure the issue names. Both read the prompt file that `resolvePrompt` (`packages/domain/src/rules/prompt.ts:40`) names: a charter's own prompt for a declared agent, else `FALLBACK_PROMPT` (`.plot/worker-prompt.sh`). Neither reads a fixed path, and neither reads `plot-install-prompt.sh --check`: its exit 3 covers `absent`, `stale`, `present` and `settings-unread` alike (`plot-install-prompt.sh:62-66`, `:93-94`, `:103-109`), and `present` is not a fault.

1. **Refuse at start (slice 1).** The existing domain rule `startCommand` (`packages/domain/src/rules/start-command.ts:54`) takes a fourth parameter, a prompt reading passed as a value: `{ runner: 'command' | 'sdk'; resolution: PromptResolution; present: boolean }`. The parameter is required, so no caller can skip the reading. The rule's order:
   - An absent key answers `unconfigured`, and `none` answers `declined`, as today. Neither reads the prompt.
   - A free agent whose command does not run the loop answers `refused`, as today.
   - A command that runs the loop (`commandRunsScript(value, loop.name)`) on the `command` runner answers `refused` when `resolution.resolve === 'refused'` (why: the charter's own why) or when `present` is false (why: `the 'Worker command' runs <loop> on the command runner, and its prompt file <path> is absent`; repair: `run plot-install-prompt.sh to write .plot/worker-prompt.sh from the template` for the fallback, or `write <path>, which charter '<name>' names` for a declared prompt).
   - The `sdk` runner answers `run` whatever `present` says.
   - An assigned agent whose command does not run the loop answers `run`, as today: such a command sources no prompt file.

   The entry `packages/board/src/server/entry/start-command.ts` (shipped as `skills/plot/scripts/board/plot-start-command.mjs`) takes the reading. It receives two more arguments, the repo root and the `Agent runner` value, and reads `PLOT_AGENT` from its environment. It reads the charter with `readCharter`/`charterPath` (`packages/domain/src/entities/charter.ts:216`, `:254`), resolves it with `resolvePrompt`, takes the runner from `runnerChoice` (`packages/domain/src/rules/runner-choice.ts:82`) with the inputs `runnerDeps` gives it (`worker-loop.ts:2168-2175`: `isWorker: true`, `defaultsToSdkWhenNamed: false`, the charter's harness), maps a `refused` runner to `command` as `runnerDeps` does (`worker-loop.ts:2176`), and checks `existsSync(join(root, prompt))`. The domain reads no file.

   The root is the main checkout, the root the loop reads (`deps.repoRoot` is `main.path`, `worker-loop.ts:306`). `plot-dispatch.sh` passes `$repo_root`, the root it already passes to `plot-prompt.mjs --launch` (`plot-dispatch.sh:934`).

   **The shell changes in place.** `ask_start_command` (`plot-dispatch.sh:1010-1033`) adds `"$repo_root"` and `"$("$script_dir/plot-config.sh" get "Agent runner" "")"` to the two existing lines of its `node` call (`:1015-1016`). Zero net shell lines; `scripts/check-shell-lines.sh pr` holds it. The `refused` arms at `:1110-1113` (`start_worker`) and `:2329-2336` (`--start`) already print the why and the repair and exit 1, so they do not change. `plot-fleetctl.sh` does not change (plans #3113 and #3128 change it).

2. **Name the file in the failure (slice 2).** `runPrompt` in `packages/fleet/src/server/entry/worker-loop.ts` already refuses at `:1550-1553` (`refusing to launch — <why>`) when the resolution names no file. It does not check that the file exists. The slice adds an injectable `promptExists?: (path: string) => boolean` to `LoopDeps` (default `existsSync`) and, on the `command` runner (`sdk === undefined`), refuses at the same site when the file is absent, with one line: `plot-worker-loop: refusing to launch — the prompt file <absolute path> is absent; run plot-install-prompt.sh to write .plot/worker-prompt.sh`.

   Today that site returns `exit: { answer: 'unstarted' }`, and `agentLoop` row 7 (`packages/domain/src/workflows/agent-loop.ts:777-797`) retries it up to `maxStartRetries` times. So the slice also adds an optional `refused?: string` to the `unstarted` arm of `PromptExit` (`packages/domain/src/rules/prompt-exit.ts:110`). Row 7 ends the loop at once when `refused` is set, with no `agent-attempt` write, and its `PLOT-BLOCKED` question (`agent-loop.ts:784`) reads `the prompt never started on <branch>: <refused> — a person decides what to fix.`. The existing charter refusal at the same site sets `refused` too, so a refused charter also ends after one line. An `unstarted` exit without `refused` (the command ran and exited non-zero) keeps today's retries and today's two lines at `worker-loop.ts:1810` and `:1814`.

### Start paths

The refusal in slice 1 runs at `ask_start_command`, and every start path reaches it before any desk is cut or any agent exists:

| Start path | How it reaches `ask_start_command` | What runs before it |
|---|---|---|
| `plot-dispatch.sh --start [N]` | `:2326`, `ask_start_command free` | the fleet-size ask only; `resolve_wt_root` and `git worktree add` follow at `:2378` and `:2435` |
| `/plot-fleet --start [N]` | `plot-fleetctl.sh` starts agents through `plot-dispatch.sh --start` (`plot-fleetctl.sh:17-18`) | the probes and the unit load; no agent |
| fleetd's own starts | `performer-shell.ts:93` runs `plot-dispatch.sh --start 1`; it reads the refusal's `worker=no-loop` footer as `unaskable` (`:103`) | nothing |
| `start_worker` (branch path) | `:1100`, after `resolve_launch` | `start_worker` pushes no claim (`:1077-1086`) |

A free agent takes its claim only after the registry hands it a slice, so a start the rule refuses leaves no claim to strand. A slug dispatch (`plot-dispatch.sh <slug>`) hands the slice to the registry and starts no worker and pushes no claim (`:4007-4029`), so it needs no check. `--restart <branch>` runs `plot-restart-command.mjs` → `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:908`), which does not ask `startCommand`; the claim already exists there, and slice 2's loop check ends that run after one named line.

The footer word stays `worker=no-loop` and the `--restart` hint at `:2333` stays as it is, because the performer matches the word. Both are wrong for this refusal; #3141 tracks that.

### Open Questions

- [x] Refuse or warn at start? **Refuse.** The rule refuses only a loop on the `command` runner whose resolved prompt file is absent, and that agent cannot run at all. A warning gives a gate nothing to hold (caller, consistent with all four jurors).
- [x] Does the SDK fallback make the file optional for the command runner? **No.** `runnerDeps` falls back to `templates/worker-prompt.md` for the `sdk` runner only (`worker-loop.ts:2181-2190`); the `command` runner sources the resolved file (`:1545-1547`). So the rule takes the runner as a reading and refuses only on `command` (caller).
- [x] Which start paths count? **All of them, through one site.** See *Start paths*: `--start`, `/plot-fleet --start` and fleetd reach `ask_start_command`; `--once` performs nothing; `--restart` is covered by slice 2 (caller; the `--restart` coverage is this round's moderator).

## Tests

Each test fails before its slice and passes after it.

### Slice 1 tests

- `packages/domain/test/start-command.test.ts`, new `describe('the prompt file')`:
  - `command` runner, fallback resolution, `present: false` → `refused`; the why names `.plot/worker-prompt.sh`, the repair names `plot-install-prompt.sh`.
  - `command` runner, `present: true` → `run`. A stale file is a present file: the rule reads existence only, so a reading built from a stale fixture also answers `run`.
  - `sdk` runner, `present: false` → `run`.
  - `command` runner, `declared` resolution naming `.plot/prompts/x.sh`, `present: false` → `refused`; the why names that path and the repair names the charter.
  - `command` runner, `refused` resolution → `refused` with the charter's why.
  - Absent key and `none` → `unconfigured` and `declined` with `present: false`; an assigned agent on a command that does not run the loop → `run` with `present: false`.
  - The existing cases pass a present `command` reading and keep their answers.
- `packages/board/test/unit/start-command-entry.test.ts` (new; no test imports `entry/start-command.ts` today): the entry's `run` with a temp repo root and no prompt file exits 3 and writes the two lines; with the file it writes `run\t…`; with `Agent runner` `sdk` it writes `run\t…`.
- `test/reconcile/dispatch.test.mjs`, beside the `worker=no-loop` cases at `:4100-4152`: `plot-dispatch.sh --start 1` in a sandbox repo whose `Worker command` runs the loop and which has no `.plot/worker-prompt.sh` exits 1, prints the why naming the file, creates no worktree under the desk root, and leaves no `refs/plot/` claim ref on the sandbox origin. The same sandbox with the file present starts one agent.

### Slice 2 tests

- `packages/domain/test/workflows-agent-loop.test.ts`, in `describe('agentLoop — row 7: prompt exit unstarted')` (`:541`): an `unstarted` exit with `refused` set and `startRetries: 0` ends at once with reason `unstarted`, writes no `agent-attempt`, and the `PLOT-BLOCKED` question contains the `refused` text. The existing two cases (no `refused`) keep their answers.
- `packages/fleet/test/unit/worker-loop-run.test.ts`: a new case with `promptExists: () => false` on the `command` runner logs exactly one `refusing to launch — the prompt file <path> is absent` line naming the absolute path, makes no run (`r.runs` empty), records no attempt, and returns 1. The row-7 case at `:440-448` sets `promptExists: () => true` and keeps its two asserted lines at `:446-447`.
- `packages/fleet/test/unit/worker-loop-sdk.test.ts`: the `sdk` runner with `promptExists: () => false` still runs; the `refusing to launch — charter x unreadable` case at `:450` now ends after one run attempt with no retry.

### Gates

Each slice runs `node skills/plot/scripts/board/plot-local-checks.mjs` and what it prints, including:

- `pnpm --filter @plot-pm/domain exec vitest related --run <changed>` and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`
- Slice 1: `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <changed>`, `pnpm run typecheck`, `node --test test/reconcile/dispatch.test.mjs`, and `./scripts/check-shell-lines.sh pr`.
- Slice 2: `pnpm --filter @plot-pm/fleet exec vitest related --run <changed>` and `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `./scripts/check-entry-exit.sh` and `./scripts/check-bundle-resolution.sh` for slice 1's entry change.

## Slices

### Refuse at start

- `feature/a-missing-plot-worker-prompt-sh-start` — `startCommand` takes a prompt reading and refuses a `command`-runner loop whose resolved prompt file is absent; `plot-start-command.mjs` supplies the reading <!-- builds: extends startCommand with a prompt-file reading -->

### Name the file

- `feature/a-missing-plot-worker-prompt-sh-line` — the worker loop refuses an absent prompt file once with a line that names it, and row 7 ends at once on a launch refusal

## Notes

- Source: https://github.com/plot-pm/plot/issues/2529. Nothing is written to the tracker.
- Panel round 1 (2026-11-04): four jurors, unanimous `amend`. Moderation in `.plot/panels/2026-11-04-a-missing-plot-worker-prompt-sh/panel.md`.
- Out of scope, filed: #3141 (the `--start` refusal footer and hint for every `startCommand` refusal), #3142 (the write probe reads only the fallback prompt path).
