## Implementation brief — fleet-agents-run-through-the-agent-sdk (wave 4: The board runs through the port)

- **Plan (canonical):** `docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `infra/the-board-commands-run-through-the-port` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

All waits have merged: `infra/an-agent-run-is-a-port` (#1293), `infra/the-loop-waits-not-the-model` (#1321) and `infra/a-run-records-its-spend` (#1326). Wave 5 (`the-sdk-is-the-default-runner`) waits on this one. Two branches are open beside it: `bug/a-turn-keeps-its-background-work` (#1327) and `infra/js-is-the-default-loop`. See the scope guard.

### What to build

**The failure it fixes.** Ten board routes start an agent with their own `spawn('sh', ['-c', '<fragment> "$@"', …], { detached: true })`. Each route reads a text exit and a log file, so none can read a hand-back, a cost or a usage limit, and the spawn ratchet (`ci.yml`, *One place reaches a process*, `allowed=28`) counts them as debt. Measured 2026-10-06 with the ratchet's own grep: 21 direct sites outside `adapters/`, ten of them these agent starts. After #1321 only the worker loop reaches the SDK. Without this wave, the SDK default in wave 5 would flip the worker and leave every board role on the shell.

What lands:

1. **The ten routes start through `agentRun`.** `idea.ts:711`, `commission.ts:407`, `reslice.ts:464`, `deliver.ts:550` (all `Idea command`), `story.ts:504`, `brief-ask.ts:116`, `implement.ts:233`, `interrogate.ts:321`, `approve.ts:373`, `auto-deliver.ts:432`. A route asks `runnerChoice` for its role. `command` keeps today's fragment start, now through the `agentRun-command` adapter. `sdk` runs the SDK adapter. A role whose fragment is absent or `none` refuses as it does today.
2. **Each role hands back its schema.** The idea, commission, reslice, story, brief and implement roles hand back `{ written: path, summary }`. The interrogate role hands back the `panel.md` path it wrote. The approve, deliver and auto-deliver roles hand back `{ outcome: 'done' | 'refused', summary }`, and the route then reads the plan's state from git, as it does today. The route checks that a `written` path exists inside the repository, then reads the file. A run that names no file, or a path that does not exist, is a failed run with that reason, never a silent success.
3. **The model per role.** A board role has no charter. It reads its `Agent models` entry, then the `--model` value of its fragment (`fragmentModel`), then the CLI default.
4. **The SDK in `board-server.mjs`**, and the spawn ratchet's `allowed` set to the count the CI grep measures after the move.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The port does not carry a board hand-back yet, and this wave extends it.** `AgentHandBack` in `packages/domain/src/ports/agent-run.ts` is the worker's `{ next, summary }`. `agent-run-sdk.ts` holds one `HAND_BACK_SCHEMA` and appends `HAND_BACK_PROTOCOL` (the `next: checks | pushed | blocked | done` paragraph) to every prompt. Both are wrong for a board role: its model would be told to end with `next: pushed`. Read both files before you design the change. The request must name the role's schema, the adapter must append the protocol paragraph that belongs to that schema, and the result must carry the board hand-back in a form that the type distinguishes from the worker's. The plan fixes the three schemas above and does not fix the port's shape. Choose the smallest widening, keep `agentLoop`'s worker path unchanged, and keep the `command` adapter answering `unaskable` for a hand-back. Wave 2's tests of the worker path pass unchanged.

**`agentRunSettings` reads the `worker` entry only.** `rules/agent-models.ts:85` calls `agentModelFor(list, 'worker')` and `fragmentModel(workerCommand)`. A board role needs the same precedence keyed by its own role name and fragment, without the charter and the window clamp it has no use for. Add a rule beside it. Do not widen `agentRunSettings` with a role flag that the worker never sets.

**The waiting gate applies to board roles too, and it costs them nothing.** Part 1 and part 2 of the plan's waiting gate (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, the five `disallowedTools`) and the `pollRefusal` hook sit in the SDK adapter and apply to every run. A board role never waits for CI. Do not add a switch to turn them off for the board.

**`agentRun` stays in the caller's process group, so a board route no longer detaches its agent.** Today each route sets `detached: true`, returns a 202 with the log path, and writes a `.state` file from the child's `exit` handler. The SDK adapter must not set `detached` (`plot-dispatch.sh --stop` and #1084 depend on it). So the route starts the run, returns its 202 without awaiting, and writes the same `.state` file when the promise settles. The routes' response shapes and the state-file contract do not change, and each route's existing tests pass on both runners.

**The consequence is real, and the PR states it.** A board stop or restart now ends a running board role, because the agent is the board's child. `board-stop-kills-continued-agents` records the same effect for `/api/continue` agents (#1307). The bound and the abort path in the adapter end the child cleanly, and the route writes the `.state` file with a non-zero code on abort. State this in the PR body as a change in behaviour. Do not restore `detached` to avoid it.

**`plot-dispatch.sh`'s brief start stays on `command`.** An SDK start from bash needs a JS entry and a bundle that carries the SDK, and the plan adds neither. `brief-ask.ts` is the SDK path for a brief. Do not touch `plot-dispatch.sh`, and the shell does not grow.

**Only the two bundles that start an agent carry the SDK.** `packages/board/build.mjs` (around line 419) names `plot-worker-loop.mjs` as the one SDK bundle. This wave adds `board-server.mjs`. A caller imports `agent-run-sdk.ts` by its own path and never through the `adapters/index.ts` barrel, which 19 board files import. A test asserts that `plot-registryd.mjs` and every other bundle do not contain the SDK. Record `board-server.mjs`'s size before (1,226,300 bytes on 2026-10-05) and after in the PR.

**The ratchet takes the measured number, as a literal.** Run the CI grep after the move and write what it prints. Do not derive `allowed` from the estate, and do not lower it below what the grep reports to make the ratchet look earned. The ten files lose their `spawn(` lines. `idea.ts` keeps its five `execFileSync('git', …)` calls, so expect about 11, and measure rather than trust that figure.

**Carried over from related work, unchanged:**

- Absent is not false. A role that hands back no file is a failed run with a reason, and an empty `written` path is the same.
- Read the structured result, not the emptiness of the output. A route's exit decision comes from the run's `end` and the hand-back, never from whether the log has text.
- The unattended declaration stays. Each route sets `PLOT_UNATTENDED=1` and its prompt-path variables in the run's `env` as it does today. `agentRunEnv` merges them over the inherited environment, so `PATH` and `HOME` reach the child.
- A usage-limit stop is not a broken prompt. `sdkRunExit` already answers it before `done`, so the route reports the limit and does not report a failed role.
- A record write failing is logged and does not fail the run.
- Nothing from the request is interpolated into a shell string. The slug is `SLUG_RE`-bounded and the prompt reaches the repository as a file. On the SDK path there is no shell, so the prompt text that names the file stays one argument.

### Done when

The plan's `## Done When`, **Slice 4**, is the specification:

- `git grep -nE "spawn\(" -- packages/board/src/server/{idea,commission,reslice,deliver,story,brief-ask,implement,interrogate,approve,auto-deliver}.ts` lists no match.
- The spawn ratchet's `allowed` equals the count the CI grep measures after the move.
- Each route's existing tests pass on both runners.
- On the SDK runner each role hands back its schema. A test shows that a run naming no file, or a missing file, ends as a failed run with its reason.
- A test shows that a board role with no `Agent models` entry runs on the model its fragment's `--model` names.
- The PR records `board-server.mjs`'s size before and after.

Assertions that exist because a naive implementation would pass without them:

- **A role's prompt carries its own protocol paragraph.** Assert that an SDK request for the `idea` role does not contain `next: pushed`, and that a worker request still does. This catches the port change that leaves `HAND_BACK_PROTOCOL` on every run.
- **A path outside the repository is refused.** Hand back `written: '../../etc/passwd'` and an absolute path outside the root. This catches a route that reads whatever the model names.
- **A refusal and a `done` differ for the approve roles.** An `outcome: 'refused'` hand-back leaves the plan's state unchanged and the route reports the summary. This catches a route that reads `done` from a clean exit.
- **The state file's content on abort.** An aborted run writes a non-zero code, as the `exit` handler does today for a signal. This catches a route whose `.state` stays absent and reads as still running.
- **A fixture `spawnClaudeCodeProcess` replays one run per role.** This proves the options each role passes without a live model, as `agent-run-sdk.test.ts` does for the worker.
- **The bundle test.** `board-server.mjs` contains the SDK, and `plot-registryd.mjs` does not.

Plus the repo's gates. This slice changes no `.sh` file, and `scripts/check-shell-lines.sh pr` must report no growth. If a change does touch shell, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. A changeset is required and names `@plot-pm/board` or `plot`. Do not commit a rebuilt `board-server.mjs` (`scripts/check-no-bundle-diff.sh` refuses it). Run `pnpm build:board` only to test the result, then restore the generated paths. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run board tests while an operator's board is open.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the ten route files named above, `packages/board/src/server/entry/` where a route's entry builds its deps, `packages/domain/src/ports/agent-run.ts`, `packages/domain/src/adapters/agent-run/`, the new per-role model rule beside `packages/domain/src/rules/agent-models.ts`, `packages/board/build.mjs`, and the ratchet line in `.github/workflows/ci.yml`. It does not own `plot-dispatch.sh`, the worker loop (`entry/worker-loop.ts`), `runner-choice.ts` or `.plot/worker-prompt.*`.

In flight, checked 2026-10-06 against `origin`:

- `bug/a-turn-keeps-its-background-work` (#1327) changes `entry/prompt-exit.ts`, `entry/prompt.ts`, `entry/worker-loop.ts`, `agent-run-command.ts`, `agent-run-sdk.ts` and `.plot/worker-prompt.sh`. **It touches two files this wave also edits.** Rebase on it when it merges, and keep your change to `agent-run-sdk.ts` to the schema and protocol selection so the merge stays small.
- `infra/js-is-the-default-loop` changes `runner-choice.ts`, `plot-worker-loop.sh`, `skills/plot-dispatch/SKILL.md` and adds `scripts/count-master-diagnosis.mjs`. It does not touch a board route. Read `runnerChoice` as it is on `main` and do not edit it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
