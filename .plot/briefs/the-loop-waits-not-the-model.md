## Implementation brief — fleet-agents-run-through-the-agent-sdk (wave 2: The loop waits, the model does not)

- **Plan (canonical):** `docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `infra/the-loop-waits-not-the-model` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Both waits have merged: `infra/an-agent-run-is-a-port` (#1293) and `infra/the-loop-runs-in-one-process` (#1292). Waves 3 (`a-run-records-its-spend`) and 4 (`the-board-commands-run-through-the-port`) wait on this one, and wave 5 on those.

### What to build

**The failure it fixes.** Measured 2026-10-05 from the transcripts: fleet sessions went from 23 turns (2026-09-30) to 384 turns (2026-10-04), and 803 of 13,844 tool turns were polls (`true`, a `cat` of a background task's output, `ListAgents`). Each poll re-reads the whole context, 40k weighted tokens at 400k, to learn nothing. The worker prompt already says "Run every test in the FOREGROUND and never end a turn waiting to be notified", and the agents do not follow it. This wave makes the loop wait and removes the model's means to wait.

Wave 1 wrote the domain half: the `agentRun` port (`ports/agent-run.ts`), `adapters/agent-run/agent-run-fixture.ts`, `pollRefusal`, `agentRunEnv`, `backgroundSwitchRefusal`, `sdkRunExit`, `runLimitRefusal`, `runnerChoice`, `fragmentModel`, and the hand-back rows in `agentLoop`. `PassConfig.sliceMaxRuns` and the `handBack`, `checksResumeId`, `handBackSummary`, `localChecks` and `sliceRuns` readings already exist in `readPass` (`entry/worker-loop.ts`), filled with `null` and `0`. This wave fills them. Read those files first and reuse them; do not re-declare a rule.

What lands:

1. **The SDK connector.** `packages/domain/src/adapters/agent-run/agent-run-sdk.ts` implements `AgentRun` over `@anthropic-ai/claude-agent-sdk` 0.3.289. It is the only file that imports the SDK, and it is NOT exported from `adapters/index.ts` (19 board files import that barrel). A caller imports it by its own path, as `prompt-exit.ts` does with `limit-lines`.
2. **The command adapter.** `adapters/agent-run/agent-run-command.ts` runs the configured shell command through `boundedRun`, as the loop does today. It answers `unaskable` for usage, cost and hand-back.
3. **The JS loop runs its prompt through `agentRun`.** `runPrompt` in `entry/worker-loop.ts` builds an `AgentRunRequest` and calls the port when `runnerChoice` answers `sdk`, and keeps today's `boundedRun` path on `command`. On `next: checks` the loop runs the commands `plot-local-checks.mjs` prints through `boundedRun` and resumes the session with the result. `loopWritesOf` throws on a `checks` write today; it applies it after this wave.
4. **Config keys** `Agent runner`, `Agent models`, `Agent max turns`, `Slice max runs` and `Agent context window`, read through `plot-config.sh get` with the defaults in the plan's Limits table (150 turns, 12 runs, 200000 window; no model named by Plot). Add them to the `Agent-runner keys` comment group in `skills/plot/scripts/plot-config.sh:106`, as comment lines only.
5. **The refusal.** The `dispatch` and `continue` controllers refuse to start a worker on `Agent runner: sdk` under `Worker loop: shell`, with `SDK_NEEDS_JS_LOOP_REASON` from `rules/runner-choice.ts`.
6. **The prompt files.** `skills/plot/templates/worker-prompt.md` (the generic text of `worker-prompt.sh` with `{branch}`, `{brief}` and `{scripts}`) and this repository's `.plot/worker-prompt.md` (the project text of `.plot/worker-prompt.sh:186`), both without the FOREGROUND sentence. The adapter appends the `next` protocol paragraph; a project file cannot drop it. Both files' headers state the declared duplicate with the `.sh`.
7. **The SDK in `plot-worker-loop.mjs`**, and in no other bundle.
8. **Default `command`.** An absent `Agent runner` reads `command` until wave 5.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The gate removes the background start; it does not chase poll shapes.** Every polling shape follows a background start. Three parts, all in the SDK adapter, for every fleet run: (1) `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1'` in `env`; (2) `disallowedTools` names `Monitor`, `ScheduleWakeup`, `CronCreate`, `TaskStop` and `ListAgents` (`ListAgents` is the canonical name of the SDK's `ListPeers` alias); (3) a `PreToolUse` hook callback that asks `pollRefusal` and returns `permissionDecision: 'deny'` with the reason. A refusal of each shape alone leaves the model to find the next one. A foreground Bash call stays allowed; its own limit is 600,000 ms, and a longer check is the reason for `next: checks`.

**The child's `env` is merged, never replaced.** The SDK's `env` option REPLACES the child's environment (`sdk.d.ts:1647`), and a child without `PATH` runs the plugin gates fail-open, the failure `agent-settings.ts:112` records. Pass `agentRunEnv(process.env, request.env)`; its test must fail for an output that lacks `PATH`, `HOME` or a `PLOT_*` name.

**A settings file cannot remove part 1.** The CLI applies a settings file's `env` key to itself. Before each run the adapter reads the `env` key of `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json` and passes them to `backgroundSwitchRefusal`; a hit ends the run `unstarted` with the file and the key named. Do not read only the project file.

**`spawnClaudeCodeProcess` never sets `detached`.** The group stop of `plot-dispatch.sh --stop` must reach `claude` (#1084). A detached child survives the stop and burns spend with no loop. On the bound, on `SIGTERM` and on the caller's exit, abort the query, then read the child's descendants through `processes` and signal them, in the order `boundedRun` documents. `Worker bound` bounds each run.

**`pathToClaudeCodeExecutable` resolves from `PATH`.** The plugin ships no 229 to 246 MB platform binary. The bundle excludes the SDK's optional platform packages; prove it with the size before and after in the PR and a test that no other bundle (`plot-registryd.mjs` and the rest) contains the SDK.

**A `checks` result and a CI correction resume the session; they do not start a fresh one.** A fresh session would re-read the brief and lose the reasoning behind the commits it is asked to fix. A fresh session starts only from the supervisor (wave 3). On `checks` the loop resumes with "local checks passed: <summary>" on a pass, and on a fail with the failing command and the last 80 lines of its output.

**The charter wins over a config key.** A worker run reads harness, model and effort from its charter (`charter.ts:104-118`), then the `worker` entry of `Agent models`, then the model its `Worker command` names (`PLOT_MODEL=sonnet` in this repository, read with `fragmentModel`), then the CLI default. A charter naming another harness runs on `command`, logged once. A charter's prompt file wins over `.plot/worker-prompt.md`. A stated `bounds.contextWindow` caps `Agent context window`. The model a repository's `Worker command` sets must still reach the run with no config edit.

**The context cap is a setting here, not an env var.** Pass `settings` as an object: the project's `Agent settings` file judged by `agentSettingsRefusal`, plus `autoCompactWindow`. `agentSettingsRefusal` refuses any `env` key in that file; that is why `CLAUDE_CODE_AUTO_COMPACT_WINDOW` sits in the `command` strings. The `command` runner keeps its prefix.

**`sdkRunExit` decides the end; the adapter does not.** Row order matters: a rejected `rate_limit_event` on a run that also handed back `done` answers the limit, never `ran`. A hand-back is read only from a run whose end is `ran`. A zeroed result (the SDK writes one when a run does not start, `sdk.d.ts:5698`) is `unstarted`, not `ran` with no hand-back.

**Carried over from related work, unchanged:**

- Absent is not false. `usageByModel` empty and `costUsd: null` mean "this connector reported none", never zero spend.
- Read the exit code and the structured result, not the emptiness of the output.
- `Slice max runs` keys to the branch and resets on a hop, as `correctionAttempts` does (#1285). `runLimitRefusal` runs before each run, and at the limit the loop starts none and ends `run-limit` with a `blocked` declaration.
- The loop's CI wait reads `BuildPort.runForSha`, which answers only for the asked commit (#1286). Do not add a second reading of CI.
- `boundedRun` stays for the local checks and for the `command` runner.
- A decision reads the index. This wave writes no spend line and no budget entry; those are wave 3's. Leave `readSpend` and `SliceSpendSchema` alone.

### Done when

The plan's `## Done When`, **Slice 2**, is the specification:

- The adapter's fixture test shows the options it passes: an `env` that holds the parent's `PATH`, `HOME` and `PLOT_*` names and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, the five `disallowedTools`, the `PreToolUse` callback, `settingSources`, `autoCompactWindow` capped by a charter's window, the charter's model and effort, and a spawn without `detached`.
- A fixture project whose `.claude/settings.json` sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` ends the run `unstarted` with the file named.
- The `dispatch` controller refuses a worker on `Agent runner: sdk` under `Worker loop: shell`, with the reason, in a test.
- A test imports the built `plot-worker-loop.mjs` and runs one fixture run through its SDK path.
- The group-stop test ends the loop and `claude` on Linux in CI, and the PR records a macOS run of it.
- `scripts/check-shell-lines.sh pr` reports no growth.

Assertions that exist because a naive implementation would pass without them:

- **The env test asserts `PATH` and `HOME` reach the child, not only that the new variable is set.** Catches the `env` replacement that makes the plugin gates fail-open.
- **The spawn test asserts the options object has no `detached` key at all, and a stop test kills the group.** Catches a child that outlives `--stop`.
- **A `settingSources` test with the variable set in the user file, not only the project file.** Catches a refusal that reads one source.
- **A loop test where `checks` is followed by a pass and then `pushed` and counts model runs: two, with no model turn between.** Catches a loop that spends a turn to ask "checks done?".
- **A loop test where `checks` fails and the resume prompt carries the failing command and the last 80 lines.** Catches a resume that sends only "failed".
- **A rejected `rate_limit_event` plus `next: done` ends the limit path.** Catches a hand-back read before the exit rows.
- **A zeroed result ends `unstarted`.** Catches the SDK's non-start read as a clean run.
- **A charter naming another harness runs `command`, with `claude` on `PATH`.** Catches the presence-of-binary default the plan rejects.
- **A worker with `PLOT_MODEL=sonnet` in its `Worker command` runs on `sonnet` with no `Agent models` entry.** Catches a model silently dropped by the switch.
- **The built-bundle test checks `plot-registryd.mjs` for the SDK and finds none.** Catches the barrel export that drags 1.2 MB into every bundle.

Plus the repo's gates. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e`.

`@anthropic-ai/claude-agent-sdk` 0.3.289 goes into `packages/domain` with its peers (`zod ^4.0.0`, `@anthropic-ai/sdk >=0.93.0`, `@modelcontextprotocol/sdk ^1.29.0`); the Artifactory proxy serves it. Do not run `pnpm build:board` into a commit: a PR's diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`); build only to test, then restore the generated paths. On a conflict in `board-server.mjs` follow Definition of Done › Resolving a board artifact conflict.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Comment lines in `plot-config.sh` count. If the slice grows a `.sh` file, pay for it in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. SDK mode lives in TypeScript, and `plot-install-prompt.sh` does not change.

A **changeset** is required: `.changeset/*.md` with the description FIRST (20 characters at least) and the `bumps:` block LAST, package `plot`, with a `plan:` line inside the same comment block. Name the new `skills/plot` bumps there (the `plot` and `plot-dispatch` skills change). Run `./scripts/check-changeset-packages.sh`. Do not edit `metadata.version` by hand.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

After merge, the operator sets `- **Agent runner:** sdk` in this repository's `## Plot Config`, in its own commit; that is not this branch's change. The PR body names the step. The first live slice on `sdk` should include at least one `checks` hand-back and one CI wait, and its PR records 0 completed polls, the refused polls, the turns per run and the peak context.

### Scope guard

This branch owns:

- `packages/domain/src/adapters/agent-run/agent-run-sdk.ts` and `agent-run-command.ts`, and their tests
- `packages/domain/package.json` and the lockfile (the SDK dependency)
- `packages/board/src/server/entry/worker-loop.ts` and `packages/board/build.mjs` (the bundle's SDK inclusion and the platform-package exclusion)
- `packages/board/src/server/dispatch.ts` and `continue.ts` (the refusal only)
- `skills/plot/templates/worker-prompt.md`, `.plot/worker-prompt.md`, and the `Agent-runner keys` comment group in `skills/plot/scripts/plot-config.sh`
- `skills/plot-dispatch/SKILL.md` and `README.md` (the prompt check names the `.md` when `Agent runner` reads `sdk`; bump the Model Guidance table only if a step changes)
- `.changeset/`

**Do not touch:** the ten board routes (`idea.ts`, `commission.ts`, `reslice.ts`, `deliver.ts`, `story.ts`, `brief-ask.ts`, `implement.ts`, `interrogate.ts`, `approve.ts`, `auto-deliver.ts`) and `board-server.mjs`'s SDK: wave 4's. `SliceSpendSchema`, `readSpend`, `planSpend`, `rateLimitEntry`, `freshAgentAfterTurnLimit` and the `Agent max spend` and `Slice max spend` keys: wave 3's. `.plot/worker-prompt.sh`, `skills/plot/templates/worker-prompt.sh` and `plot-worker-loop.sh`: they stay as they are. The spawn ratchet's `allowed` in `ci.yml`: wave 4 sets it. The rules wave 1 wrote change only where a test of yours finds a defect; report that rather than rewriting the rule.

No other branch of this plan is in flight: `git ls-remote --heads origin` at brief time lists only `main` and `changeset-release/main`. Wave 3 also waits on `feature/a-spent-correction-budget-gets-a-fresh-agent`, which is already merged (#1291).

The plan's two Open Questions (the scale of `utilization` and `resetsAt`; the per-run turn distribution) belong to waves 3 and 5. Leave them open. Carry `utilization` and `resetsAt` through `AgentRunLimitReading` unconverted.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
