## Implementation brief — a-missing-plot-worker-prompt-sh (wave 2: Name the file)

- **Plan (canonical):** docs/plans/2026-11-04-a-missing-plot-worker-prompt-sh.md on main
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3131 merged
- **Branch:** `feature/a-missing-plot-worker-prompt-sh-line` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — Plot's review app and CI, per the repo's convention

Wave 1 (`feature/a-missing-plot-worker-prompt-sh-start`, #3150) has merged: `startCommand` now refuses at start. This wave covers the paths that wave cannot: `--restart` on an existing claim, and a prompt file that disappears after the start. Nothing waits on this branch.

### What to build

On issue #2529 a repository with no `.plot/worker-prompt.sh` failed both approved slices with `the command exited 1 without the agent doing any work`, three attempts each. Neither line names the file, and the slice stays claimed with no agent. Wave 1 stops a new start. A claim stranded before the fix, or one resumed with `plot-dispatch.sh --restart <branch>`, still reaches the worker loop, so the loop must name the file and stop after one line.

Two changes, both in the plan's *Approach* item 2:

1. `runPrompt` in `packages/fleet/src/server/entry/worker-loop.ts` (`:1537`) already refuses at `:1550-1553` when the resolution names no file. Add `promptExists?: (path: string) => boolean` to `LoopDeps` (`:1288`, default `existsSync`). On the `command` runner (`sdk === undefined`), refuse at the same site when `file` is absent, with one line: `plot-worker-loop: refusing to launch — the prompt file <absolute path> is absent; run plot-install-prompt.sh to write .plot/worker-prompt.sh`.
2. Add an optional `refused?: string` to the `unstarted` arm of `PromptExit` (`packages/domain/src/rules/prompt-exit.ts:110`). `runPrompt` sets it on both refusals at that site, the existing charter refusal and the new file refusal. `agentLoop` row 7 (`packages/domain/src/workflows/agent-loop.ts:775-797`) ends the loop at once when `refused` is set: no `agent-attempt` write, and a `PLOT-BLOCKED` question that reads `the prompt never started on <branch>: <refused> — a person decides what to fix.`. An `unstarted` exit without `refused` keeps today's retries and today's two lines at `worker-loop.ts:1810` and `:1814`. The plan holds the exact texts and is canonical; this is orientation.

The `refused` text must travel from `runPrompt`'s outcome to `PromptExit`. `prompt-exit.ts:393` builds `{ answer: 'unstarted' }` from `status !== 0`, so trace how the outcome reaches that function and carry the text through it. Do not set `refused` from the exit status.

### Settled decisions — do not re-derive

- **Read the file `resolvePrompt` names, never a fixed path.** A declared charter has its own prompt. `plot-install-prompt.sh --check` is not the reading: its exit 3 covers `absent`, `stale`, `present` and `settings-unread` alike, and `present` is not a fault.
- **The `sdk` runner is not refused.** It falls back to `templates/worker-prompt.md` (`worker-loop.ts:2181-2190`). Only `sdk === undefined` checks the file. A test holds this: `promptExists: () => false` on `sdk` still runs.
- **Existing refusal and new refusal end alike.** A refused charter used to retry three times. After this wave it ends after one line. That change is intended and the plan's *Slice 2 tests* name the case at `worker-loop-sdk.test.ts:450`.
- **The claim is not released here.** A claim stranded earlier still needs `plot-dispatch.sh --restart <branch>`. The loop ends with a `PLOT-BLOCKED` marker and releases nothing.
- **Leave `plot-fleetctl.sh`, the `--start` footer and the `--restart` hint alone.** #3141 and #3142 track them, and plans #3113 and #3128 change `plot-fleetctl.sh`.
- **Rules carried over:** absent is not false, and a retry loop that cannot succeed is a defect, not a policy. A refusal that names no file reads as a worker failure, which is how #2529 cost two slices and three attempts each.

### Done when

The plan's `## Tests` section, *Slice 2 tests*, is the specification, and `## Changelog` bullet 2 is the behaviour. Assertions that exist because a naive implementation would pass without them:

- The row 7 test asserts no `agent-attempt` write and `startRetries: 0`. A test on the question text alone passes when the loop still retries first.
- The loop test asserts `r.runs` is empty and exactly one log line. It catches an implementation that logs the refusal but still launches.
- The `sdk` case with `promptExists: () => false` still runs. It catches a check that ignores the runner.
- The row-7 case at `worker-loop-run.test.ts:440-448` sets `promptExists: () => true` and keeps its two asserted lines. It catches a changed default for an `unstarted` exit without `refused`.

Plus: this branch edits TypeScript only, so `scripts/check-shell-lines.sh` has nothing to count. Add a changeset with the description first and the `bumps:` block last, naming `plot-fleet` (`plot` package). Do not commit a rebuilt generated bundle. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

New functions are arrows (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and its failure, with no history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/server/entry/worker-loop.ts`, `packages/domain/src/rules/prompt-exit.ts`, `packages/domain/src/workflows/agent-loop.ts`, their tests (`workflows-agent-loop.test.ts`, `worker-loop-run.test.ts`, `worker-loop-sdk.test.ts`), and the changeset. Wave 1 owned `start-command.ts`, `plot-dispatch.sh` and `dispatch.test.mjs`; do not reopen them. Plans #3113 and #3128 change `plot-fleetctl.sh`; stay out of it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
