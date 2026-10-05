## Implementation brief — fleet-agents-run-through-the-agent-sdk (wave 1: An agent run is a port)

- **Plan (canonical):** `docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `infra/an-agent-run-is-a-port` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This wave waits on nothing. Waves 2 (`the-loop-waits-not-the-model`) and 4 (`the-board-commands-run-through-the-port`) build on it, and wave 3 and 5 build on those. Everything the later waves import — the port, the rules, the loop's hand-back rows — is written here, in `packages/domain`, with **no SDK dependency**. The SDK is wave 2's.

### What to build

**The failure it prepares for.** Measured 2026-10-05 from the transcripts: fleet sessions went from 23 turns (2026-09-30) to 384 turns (2026-10-04) with 8 times the peak context, and 803 of 13,844 tool turns were polls (`true`, a `cat` of a background task's output, `ListAgents`). Each poll re-reads the whole context to learn nothing. The plan moves the waiting out of the model: the agent ends its turn with a hand-back, and the loop waits. This wave builds the domain half, as pure rules and one port, so waves 2 and 4 plug an adapter in without deciding anything.

What lands:

1. **The port.** `packages/domain/src/ports/agent-run.ts` declares `AgentRun.run(request): Promise<PortResult<AgentRunResult>>`. The request holds the desk, the prompt, a session to resume or none, the role, the harness, the model, the effort, the limits, the bound, the capabilities, the extra environment and the log file. The result holds the session id, the run's end, the hand-back, the session's cumulative usage per model, its cost estimate, the turns this run took and the rate-limit readings. **It names no SDK type.** An `agent-run-fixture.ts` adapter for tests. No `agent-run-sdk.ts` and no `agent-run-command.ts`: those are wave 2.
2. **Seven rules**, each an arrow in `packages/domain/src/rules/`: `pollRefusal`, `agentRunEnv` and `backgroundSwitchRefusal` (the last two in `agent-run-env.ts`), `sdkRunExit`, `runLimitRefusal` (`run-limit.ts`), `runnerChoice` (`runner-choice.ts`) and `fragmentModel`. The plan's Design gives each rule's file and signature.
3. **`limitAnswer` extracted from `promptExit`** (`rules/prompt-exit.ts:295`). It is the block from `resolveReset` to the end of the function: `end-limited` with `no-reset`, `past-bound`, `no-progress`, else `wait`. `sdkRunExit` calls it with `resetsAt` as the reset. `promptExit`'s tests pass **unchanged**.
4. **The hand-back rows in `agentLoop`** (`workflows/agent-loop.ts`). The `next` values `checks`, `pushed`, `blocked` and `done` arrive as one more reading, consulted only where the exit is `ran`. Rows go between today's ROW 9 and ROW 10, so a usage-limit stop never reads as `done`.
5. **Three endings.** `turn-limit`, `run-limit` and `spend-limit` join `EndingReasonSchema` (`entities/ending.ts:96`), and `endingIsAttributable` (`transitions/agent.ts`) admits actor `agent` for them. `agentLoop` writes them only for the rows that name them; no caller sets them until wave 2.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The adapter is a connector behind a NEW port, not a method on `boundedRun` or `performer`.** `boundedRun` runs any command to its bound and owns no account; a connector's duties (record the spend, report the limit) must not land on a filesystem-kind port. `performer` starts detached processes that outlive the caller, and an agent run must stay in its caller's process group (#1084). Do not widen either.

**`agentRunEnv` merges; it never replaces.** The SDK's `env` option REPLACES the child's environment (`sdk.d.ts:1647`). A child without `PATH` runs the plugin gates fail-open, the failure `agent-settings.ts:112` records. So `agentRunEnv(inherited, plotEnv)` returns `{ ...inherited, ...plotEnv, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }`, and its test asserts that `PATH`, `HOME` and **every `PLOT_*` name of the input** reach the output. The test must fail for an output that lacks any of the three.

**The gate removes the background start; it does not chase each poll shape.** Every polling shape follows a background start. Refusing `true`, `cat`-of-task-output and `ListAgents` one by one leaves the model to find the next shape. `pollRefusal(toolName, input)` is part 3 of three, and the other two live in wave 2's adapter. It refuses: a Bash or Agent call with `run_in_background: true`; a Bash command that is only `sleep`, only `true`, a `ps` read of a process, or a `sleep` before a status read; `gh run watch` and `gh pr checks`; a read of a background task's output file. A foreground `pnpm test` stays allowed. The reason text starts with the fixed string `plot: poll refused` and tells the model to end its turn with `next: checks` or `next: pushed`. Wave 5 counts refused polls by that string, so **do not reword its first words**.

**`sdkRunExit` rows apply in the plan's order, and the order is the rule.** The table is in Design › Approach. The two orderings a naive implementation gets wrong: a rejected `rate_limit_event` beats `success` (so a run that handed back `done` but met a limit answers the limit, not `ran`), and `is_error: true` on any other `terminal_reason` is `unstarted` with the reason logged, never `ran`. A hand-back is read only from a run whose end is `ran`.

**`unstarted` for a zero-turn `error_during_execution` is not a limit and not a bound.** Do not fold it into `end-limited`.

**A zeroed result is not a counter reset — this belongs to wave 3, but your port's result must carry what wave 3 needs.** The result's usage is the session's CUMULATIVE figure as the SDK reports it, never a sum you computed, and `turns` is this run's turns. Do not add a "delta" field to the port.

**`runnerChoice` reads what the project wrote, never `PATH`.** `Agent runner` set wins. When absent it answers `command` in this wave and every later one until wave 5 flips it, and it logs its reason once. Its table: a board role reads `sdk` only where the first command word of its fragment (after any `NAME=value` prefixes) is `claude`; the worker role needs `Worker loop` = `js` **and** a charter whose harness is `claude` or unstated. A worker under `Worker loop: shell` with `Agent runner: sdk` is a refusal, with the plan's exact reason: "`Agent runner: sdk` needs `Worker loop: js`; set `Worker loop: js`, or set `Agent runner: command`". `claude` on `PATH` decides nothing, and a test holds the answer for a `PATH` that has it.

**`fragmentModel(fragment)` is NEW; the plan's Design says "the same reading the board roles use", and no such reading exists.** Verified at dispatch: `git grep fragmentModel` over `packages/` and `skills/` returns nothing, and no board file parses `--model`. The plan's own `## Slices` line lists it as a deliverable of this wave, and that line is right. It reads the single flag `--model <value>` (and `--model=<value>`) from a command fragment and returns the value or no answer; it also reads the `PLOT_MODEL=` prefix a `Worker command` sets (this repository's does: `PLOT_MODEL=sonnet`). Absent is not false: a fragment with no model answers *none*, never the string `''` taken as a model name.

**The charter wins over a config key** (Design › "The charter wins over a config key"). The model precedence for a worker is charter, then the `worker` entry of `Agent models`, then the model its `Worker command` sets, then the CLI's default. This wave states it in `runnerChoice`'s or a sibling rule's inputs; the adapter that carries it out is wave 2's.

**The hand-back is a reading, not a state.** `agentLoop` carries no state between passes (a test already asserts no write carries a loop state). The `next` value therefore comes in as a field of `AgentLoopReadings`, filled by the caller on each pass. Do not store it. The rows:

| `next` | `agentLoop` decides |
|---|---|
| `checks` | a write that tells the performer to run the local checks and resume the session with the result; **no model turn between the checks and the resume**. |
| `pushed` | the existing CI wait (rows 12-18); on a pass it seals, on a fail it resumes with the correction. |
| `blocked` | ends `blocked`, as ROW 10 does. |
| `done` | reads the desk as today: ROW 10 marker, ROW 11 unlanded work, ROW 12a no PR. |

`checks` needs a new `Write` kind in `workflows/decision.ts`; the `agent-resume` write (`decision.ts:245`, `resumeId: ''` means a fresh worker) is the model for it. **Read `Write`'s consumers before adding the kind**: a new kind that a performer's `switch` does not handle is a compile error in every adapter, which is the intended safety, so fix those switches rather than adding a `default`.

**`runLimitRefusal(runs, limit)` is decided before each run.** At the limit the loop starts no run and ends `run-limit`. The default is 12 (`Slice max runs`), and the count is keyed to the branch and resets on a hop, as `correctionAttempts` is keyed (#1285). The count and the key come in as readings; the rule reads neither a file nor an environment variable.

**Rules carried over unchanged.** Absent is not false: a missing record, config key or hand-back reads as *no answer*, never as the answer the code happens to want. Read the exit code, not the emptiness. A function you write is an arrow. The actor is an **Agent**; add no `Worker`-named type or field outside the six process states. A **Slice** holds one branch; add no new `Wave` where `Slice` is meant. A TSDoc block states behaviour (what it does, its parameters, its return, how it fails), not the history of the decision: the reasoning belongs in the commit message.

### Done when

The plan's `## Done When` › **Slice 1** is the specification:

- `pollRefusal`, `agentRunEnv`, `backgroundSwitchRefusal`, `sdkRunExit`, `runLimitRefusal`, `runnerChoice` and `fragmentModel` have the tests in the plan's Tests list, and the domain's 100% coverage gate passes over them.
- `promptExit`'s existing tests pass unchanged after `limitAnswer` is extracted.
- The fixture-adapter test shows a run that hands back `checks` and then `pushed` costs two model runs, and the loop runs the checks and the CI wait with no model turn between them.
- `agentRunEnv`'s test fails for an output that lacks `PATH`, `HOME` or a `PLOT_*` name of the input.
- `runnerChoice` answers `command` for a fragment whose command word is not `claude`, for a charter that names another harness, and for a worker under `Worker loop: shell`, whatever `PATH` holds.

Assertions that exist because a naive implementation would pass without them:

- **`sdkRunExit` on a rejected `rate_limit_event` with a `done` hand-back answers the limit.** Catches a table read bottom-up, where `success` is matched first and a usage-limit stop reads as finished work.
- **`agentRunEnv` given an input with a `PLOT_BRANCH` and a `PATH` returns both.** Catches the SDK's replace semantics, the one that runs gates fail-open.
- **`backgroundSwitchRefusal` names the file when a project's `.claude/settings.json` sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `0`.** Catches a refusal that says only *refused*; the reason names the file and the key.
- **`pollRefusal` allows a foreground `pnpm test` and refuses `sleep 30 && gh pr checks`.** Catches a rule that refuses every Bash call or only the single-word shapes.
- **`runnerChoice` with `claude` on `PATH` and a fragment that starts `gemini` answers `command`.** Catches the presence-of-binary default the plan rejects.
- **`fragmentModel` of a fragment with no `--model` answers none, not `''`.** Catches a missing model read as a model.
- **An `agentLoop` pass with `next: 'checks'` and a limit exit answers the limit.** Catches the hand-back row placed before the exit rows.
- **A `runLimitRefusal` at the limit starts no run and ends `run-limit` with a `blocked` declaration.** Catches an ending that waits for a person nobody told.

Plus the repo's gates. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e`. This slice is `packages/domain` only, so the checks it prints are the domain's `vitest related`, `tsc --noEmit` and the `scripts/check-*.sh` list; the purity gate must keep reporting 0 violations (the domain imports `zod` and nothing else outside `adapters/`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file. If you find yourself adding a shell line, stop: write the rule in the domain and ask it through a bundle, or remove shell elsewhere in the same change. The gate stores no number and has no override.

A **changeset** is required: `.changeset/*.md` with the description FIRST (20 characters at least) and the `bumps:` block LAST, package `plot`, and a `plan:` line naming this plan inside the same comment block. Run `./scripts/check-changeset-packages.sh`. Do not edit `metadata.version` by hand. Do not commit a rebuilt `board-server.mjs` (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/ports/agent-run.ts` and `packages/domain/src/adapters/agent-run/agent-run-fixture.ts`
- `packages/domain/src/rules/` — `poll-refusal.ts`, `agent-run-env.ts`, `sdk-run-exit.ts`, `run-limit.ts`, `runner-choice.ts` and `fragmentModel`, and the `limitAnswer` extraction in `prompt-exit.ts`
- `packages/domain/src/workflows/agent-loop.ts` and `decision.ts` — the hand-back reading, its rows and the new write kind
- `packages/domain/src/entities/ending.ts` and `packages/domain/src/transitions/agent.ts` — the three endings and their attribution
- `packages/domain/test/` for all of it, and `packages/domain/src/index.ts` for the exports
- `.changeset/`

**In flight beside it**, verified at dispatch with `git ls-remote --heads origin`:

- `feature/a-spent-correction-budget-gets-a-fresh-agent` — **a known collision.** It adds `corrections-spent` to the same `EndingReasonSchema` and edits `endingIsAttributable` in `transitions/agent.ts`, plus `index.ts` and `adapters/index.ts`. Both changes append to one enum and one `!==` chain, so the rebase is mechanical: keep both sets of values and both clauses of the refusal's sentence. Do not edit its `rules/fresh-agent.ts` or its port. Whichever merges second does the rebase.
- `infra/the-loop-runs-in-one-process` (PR #1292) — the JS loop (`packages/board/src/server/entry/worker-loop.ts`, `plot-worker-loop.sh`, `packages/board/build.mjs`) and `ports/transcript.ts`, `ports/processes.ts`, `ports/trees.ts`. It does not edit `agent-loop.ts`. Wave 2 waits on it; this wave does not. **Do not touch `worker-loop.ts`** to wire the hand-back: the loop's use of it is wave 2.
- `feature/a-question-is-listed-as-waiting-on-you` — the board's fleet payload; no overlap.

**Do not touch:** any `skills/**/*.sh`; `packages/board/**`; `.plot/worker-prompt.sh` and the `## Plot Config` section of `CLAUDE.md` (the new keys `Agent runner`, `Agent models` and the rest are wave 2's, and `plot-config.sh`'s key list is wave 2's); `package.json` and the lockfile (no SDK dependency in this wave — if a test seems to need `@anthropic-ai/claude-agent-sdk`, the rule is taking an SDK type it must not name, so describe the shape in the port's own types instead).

The plan's two Open Questions (the scale of `utilization` and `resetsAt`; the per-run turn distribution) belong to waves 3 and 5. Leave them open.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
