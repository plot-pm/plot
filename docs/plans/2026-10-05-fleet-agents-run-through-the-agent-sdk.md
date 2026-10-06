# Fleet agents run through the Agent SDK

> A fleet agent run that Plot starts from TypeScript goes through the Claude Agent SDK behind an `agentRun` port. The agent ends its turn when it has pushed or needs a long check, the loop does the waiting outside the model, and the next turn starts with only the result.

## Status

- **State:** Approved
- **Type:** infra
- **Story:** the-supervisor-delivers-the-approved-scope
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-10-05, jwloka, in-session
- **Started:** 2026-10-05, jwloka, `infra/an-agent-run-is-a-port`
- **Started:** 2026-10-06, jwloka, `infra/the-loop-waits-not-the-model`
- **Started:** 2026-10-06, jwloka, `infra/a-run-records-its-spend`

## Changelog

- A fleet agent on the SDK runner no longer waits inside its session. It ends its turn when it has pushed, or when it needs the local checks, and the loop runs the checks and waits for CI without a model turn. The next turn starts with only the result.
- A fleet agent on the SDK runner cannot start a background task, and a poll for one is refused with the reason. A run that would sleep, watch CI or read a background task's output gets a refusal that tells it to end its turn.
- Each SDK run records what its session spent (tokens and the SDK's cost estimate per model) and each usage-limit reading. The supervisor reads both from the records, not from a live session.
- New `## Plot Config` keys: `Agent runner` (`sdk` or `command`), `Agent models`, `Agent max turns`, `Agent max spend`, `Slice max runs`, `Slice max spend` and `Agent context window`. A repository without `Agent runner` runs on `command` until the default flips. After the flip, a role runs on the SDK only where the project already names `claude` for it and the worker loop is `js`.
- A run that reaches its turn limit ends `turn-limit`, and the supervisor starts one fresh session for the slice before it asks a person. A run or a slice that reaches its spend or run limit ends `spend-limit` or `run-limit` and goes to a person.

<!-- Board impact: no change to the plan format, the template or the docs/plans layout. The desk's ending gains three reasons, `turn-limit`, `run-limit` and `spend-limit`, which the board reads through `EndingReasonSchema` (slice 1). The slice-spend record gains a second line kind, the run line; `readSpend` and `planSpend` read it, and the board's plan cost changes definition at the runner switch because run lines include subagents and compaction (slice 3). Ten board routes move from `sh -c` to the `agentRun` port, which lowers the spawn ratchet (slice 4). The SDK's JS joins `plot-worker-loop.mjs` (slice 2) and `board-server.mjs` (slice 4), and no other bundle. -->

## Motivation

Measured 2026-10-05 from the transcripts under `~/.claude/projects/` for this repository. Weighted tokens count a cache read as 1/10 of a token.

| Day | Fleet sessions | Turns per session | Mean peak context | Weighted tokens |
|---|---|---|---|---|
| 2026-09-30 | 82 | 23 | 59k | 41M |
| 2026-10-02 | 29 | 142 | 276k | 129M |
| 2026-10-03 | 19 | 213 | 332k | 126M |
| 2026-10-04 | 6 | 384 | 454k | 90M |

- From 2026-09-30 to 2026-10-04 the fleet ran 14 times fewer sessions, each with 17 times more turns and 8 times the peak context, for twice the weighted tokens.
- Sessions whose first prompt is "You are implementing the branch…" used 250M weighted tokens in the 3 days to 2026-10-05.
- Polling turns were 803 of 13,844 tool turns, and 9% of the context read. They are `true`, a `cat` of a background task's output, and `ListAgents`. The largest session, desk `free-9172bc8c` (8.8 MB of transcript), made 190 `true` calls and 184 `cat` calls of task output. `ScheduleWakeup` (220 turns) and `ps` reads (188 turns) are two more waiting shapes.
- Each polling turn re-reads the whole context to ask "done yet?". At 400k context, one such turn reads 400k tokens of cache, 40k weighted, to learn nothing.

**Where the spend goes.** Of 394M weighted tokens in fleet sessions since 2026-10-02, waiting turns of every shape are 11% to 18%, by a narrow and a broad classifier. About 80% is ordinary work: Bash 59%, Read 11%, Edit 9%. On each day from 2026-10-02 to 2026-10-05, 77% to 94% of the spend runs at a context above 200k. In 29 of 63 sessions the turn count passes 150, and the turns after the 150th carry 57% of the spend.

**Every polling shape follows a background start.** `true` and a `cat` of task output poll a background Bash job, and `ListAgents` polls a background subagent. The worker prompt in `.plot/worker-prompt.sh` already says "Run every test in the FOREGROUND and never end a turn waiting to be notified". That is a rule, and the measurement shows that the agents do not follow it.

**The stopgap, and what each change addresses.** On 2026-10-05, commit c172910a8 set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` on the six fleet commands in this repository's `## Plot Config`. It is in the command strings because `agentSettingsRefusal` refuses any `env` key in `.plot/agent-settings.json`. The 200k cap addresses the larger share: the work turns above 200k context. It is not yet measured, because one fleet session has run since it landed (peak 196k). This plan addresses the rest: the waiting share, a limit per run and per slice, and the control the loop gets over a run (a hand-back, a run's end reason, its spend and its usage-limit readings). Slice 5 compares the SDK runner against the cap-only `command` runner, so the plan claims no saving that the cap already makes.

**Why this serves the story.** A session that spends 384 turns on one slice is a stop that nobody sees: the loop reads it as a running prompt until `Worker bound`. With a turn limit per run and a run and spend limit per slice, a runaway slice ends with a reason the supervisor reads, and the supervisor can fix it or escalate it, as `the-supervisor-delivers-the-approved-scope` requires.

## Design

### Approach

**The requirement, in the operator's words:** "The loop, not the model, waits for CI and for background tests. No turn is spent re-reading 400k to ask 'done yet?'."

**What was read.** `@anthropic-ai/claude-agent-sdk` 0.3.289, published with Claude Code 2.1.289 (its `manifest.json`, build 2026-10-03). The plan names only options read from that version's `sdk.d.ts` and `sdk-tools.d.ts`. The files were read from `registry.npmjs.org`.

**The SDK runs the Claude Code CLI as a child process.** `query({ prompt, options })` starts the `claude` executable and talks to it over stdin and stdout. The executable comes from an optional per-platform package (229 to 246 MB each), or from `pathToClaudeCodeExecutable`. `spawnClaudeCodeProcess(options)` replaces the default spawn, and `Query.close()` ends the child. So the process-tree story stays: one more Node layer (the loop or the board) holds a `claude` child, as `boundedRun` holds one today.

**SDK options this plan uses (0.3.289):**

| Need | Option or field |
|---|---|
| model and effort | `model`, `fallbackModel`, `effort` |
| turn limit per run | `maxTurns`; the result's `subtype: 'error_max_turns'` |
| spend limit per run | `maxBudgetUsd`; the result's `subtype: 'error_max_budget_usd'`. It counts only the spend since this `query()` started. |
| a resumed or fresh session | `resume: sessionId` resumes; `sessionId` sets the id of a new session; omitting both starts a fresh one |
| tools | `disallowedTools` (removed from the model's context), `allowedTools`, `tools` |
| hooks | `hooks: { PreToolUse: [{ matcher, hooks: [callback] }] }`; the callback returns `hookSpecificOutput.permissionDecision: 'deny'` with `permissionDecisionReason` |
| settings | `settings` (a path or a `Settings` object), `settingSources` (`'user' \| 'project' \| 'local'`; omitted loads all three, as the CLI does) |
| permission mode | `permissionMode: 'bypassPermissions'` with `allowDangerouslySkipPermissions: true` |
| abort | `abortController`; `Query.interrupt()`; `Query.close()` |
| child environment | `env`. It REPLACES the child's environment and is not merged with `process.env` (`sdk.d.ts:1647`). |
| hand-back | `outputFormat: { type: 'json_schema', schema }`; the result's `structured_output` |
| run end | `SDKResultMessage.subtype` (`success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`), `is_error`, `terminal_reason` (`TerminalReason`, `sdk.d.ts:9685`), `startup_failure_reason` |
| usage and cost | `SDKResultMessage.modelUsage` (per model: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`), `total_cost_usd`, `session_id`. Both totals are cumulative for the session: a resumed session continues from the totals its transcript saved (`sdk.d.ts:5781`, `:5789`). |
| usage limit | `SDKRateLimitEvent.rate_limit_info`: `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt`, `rateLimitType`, `utilization`. Sent for claude.ai subscription accounts only. |
| account | `Query.accountInfo()`: `email`, `organization` |
| context cap | the `Settings` key `autoCompactWindow` |

**The adapter is a connector, behind a new `agentRun` port.** The SDK reaches a remote service with an account, credentials and a rate limit, and it reports that limit (`rate_limit_event`). That is the connector kind in CLAUDE.md. Neither existing port fits:

- `boundedRun` runs any command to its bound and owns no account. A connector's duties (record the spend, report the limit) do not belong on it, by the rule that a filesystem port must not implement them.
- `performer` starts detached processes that outlive the caller. An agent run is owned by its caller and must stay in the caller's process group (#1084).

So `packages/domain/src/ports/agent-run.ts` declares `AgentRun.run(request): Promise<PortResult<AgentRunResult>>`. The request holds the desk, the prompt, a session to resume or none, the role, the harness, the model, the effort, the limits, the bound, the capabilities, the extra environment and the log file. The result holds the session id, the run's end (the `sdkRunExit` answer below), the hand-back, the session's cumulative usage per model, its cost estimate, the turns this run took (the adapter counts the `assistant` messages it streams) and the rate-limit readings. It names no SDK type. Three adapters implement it:

- `adapters/agent-run/agent-run-sdk.ts`, the connector. It is the only file that imports `@anthropic-ai/claude-agent-sdk`, which the purity gate allows only under `adapters/`. It is NOT exported from the `adapters/index.ts` barrel, which 19 board files import; a caller imports it by its own path, as `prompt-exit.ts` imports `limit-lines`. So only the two bundles that start an agent carry the SDK.
- `adapters/agent-run/agent-run-command.ts` runs the configured shell command, as the board and the loop do today. It answers `unaskable` for usage, cost and hand-back, because a shell command reports none of them.
- `adapters/agent-run/agent-run-fixture.ts`, for tests.

**The SDK adapter keeps the process rules `boundedRun` states.** It passes `spawnClaudeCodeProcess` with a spawn that never sets `detached`, so the group stop of `plot-dispatch.sh --stop` still reaches `claude`. It passes `pathToClaudeCodeExecutable` resolved from `PATH`, so the plugin ships no 230 MB binary and the run uses the operator's installed CLI (2.1.289 on this machine on 2026-10-05). On its bound, on `SIGTERM` and on the caller's exit, it aborts the query, then reads the child's descendants through `processes` and signals them, the order `boundedRun` documents. `Worker bound` keeps its meaning: it bounds each run.

**The child keeps its environment.** The adapter passes `env: { ...process.env, ...request.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }`. `request.env` holds the `PLOT_*` names the loop sets today (`PLOT_BRANCH`, `PLOT_WORKTREE`, `PLOT_UNATTENDED`, `PLOT_AGENT`, `PLOT_SCRIPT_DIR` and the others `.plot/worker-prompt.sh` reads). The merge is the reason this option is safe: `env` replaces the environment, and a child without `PATH` runs the plugin gates fail-open, the failure `agent-settings.ts:112` records. A rule, `agentRunEnv(inherited, plotEnv)` in `packages/domain/src/rules/agent-run-env.ts`, builds the object, and its test asserts that `PATH`, `HOME` and every `PLOT_*` name of the input reach the output.

**The turn protocol.** Each worker run passes `outputFormat` with one JSON schema: `{ next: 'checks' | 'pushed' | 'blocked' | 'done', summary }`. The agent ends its turn with one of four values:

| `next` | The agent has | The loop then |
|---|---|---|
| `checks` | committed work and wants the local checks | runs the commands `plot-local-checks.mjs` prints, through `boundedRun`, with no model turn. It resumes the session with the result: on a pass the one line "local checks passed: <summary>"; on a fail the failing command and the last 80 lines of its output. |
| `pushed` | pushed and opened its PR | waits for CI through `agentLoop`'s CI wait (`checksFromRuns` over `BuildPort.runForSha`). On a pass it seals. On a fail it resumes with the correction, as the correction path does today. |
| `blocked` | written `PLOT-BLOCKED.md` | ends `blocked`, as `agentLoop`'s table says |
| `done` | nothing more to do on this slice | reads the desk as today: a marker, unlanded work (`holding-work`) or a PR |

`agentLoop` takes the hand-back as one more reading, and the new rows join its table with their tests. A hand-back is read only from a run whose end is `ran` in the table below.

**A run's end maps to the loop's existing answers.** Today the loop reads a prompt's exit through `promptExit` (`packages/domain/src/rules/prompt-exit.ts`), which answers `wait`, `end-limited`, `unstarted` or `ran` (`:76-85`) from the exit status and `HARNESS_LIMIT_LINES` over the output. An SDK run has no text exit, so a second rule reads the structured result: `sdkRunExit(reading)` in `packages/domain/src/rules/sdk-run-exit.ts`. Both rules share one function for the limit case, `limitAnswer(reset, boundSeconds, ranSeconds, afterWait, commitsSinceWait)`, extracted from `promptExit` with its tests unchanged. The rows apply in this order, so a usage-limit stop never reads as `done`:

| The run | `sdkRunExit` answers | The loop then |
|---|---|---|
| the spawn fails, no result message arrives, `startup_failure_reason` is set, or `error_during_execution` with `num_turns: 0` | `unstarted` | as today: the `unstarted` path |
| a `rate_limit_event` with `status: 'rejected'`, or `terminal_reason` `blocking_limit` or `rapid_refill_breaker` | `limitAnswer` with `resetsAt` as the reset: `wait` or `end-limited` | as today: waits for the reset, or ends `limited` |
| aborted on the bound | the bound path | ends `bound`, as today |
| `error_max_turns` or `terminal_reason: 'max_turns'` | `turn-limit` | ends `turn-limit` with a `blocked` declaration |
| `error_max_budget_usd` or `terminal_reason: 'budget_exhausted'` | `spend-limit` | ends `spend-limit` with a `blocked` declaration |
| `is_error: true` on any other `terminal_reason` (`api_error`, `model_error`, `prompt_too_long` and the rest) | `unstarted`, with the reason logged | the answer a non-zero prompt exit gives today |
| `success` with a `structured_output` that matches the schema | `ran` with the hand-back | the `next` row above |
| `success` with no `structured_output`, or `error_max_structured_output_retries` | `ran` with no hand-back, the reason logged | reads the desk, as every run does today |

**The board's runs hand back what they wrote.** A board role has no CI to wait for: it ends when it has written its file or made its git change. Each role passes its own `outputFormat` schema. The idea, commission, reslice, story, brief and implement roles hand back `{ written: path, summary }`; the interrogate role hands back the `panel.md` path it wrote, the one file that names the round. The approve, deliver and auto-deliver roles change a plan's phase through their script and hand back `{ outcome: 'done' | 'refused', summary }`; the route then reads the plan's state from git, as it does today. The route checks that a `written` path exists inside the repository and then reads the file. A run that names no file, or a path that does not exist, is a failed run with that reason, never a silent success.

**The waiting gate: no background start, and a refused poll.** The measurement shows that every polling shape follows a background start, so the gate removes the background start. A refusal of each poll shape alone would leave the model to find the next one. Three parts, all in the SDK adapter, for every fleet run:

1. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1'` in the merged `env` above. Under it the CLI backgrounds nothing (`Query.backgroundTasks()` throws, `sdk.d.ts:3232`).
2. `disallowedTools` names `Monitor`, `ScheduleWakeup`, `CronCreate`, `TaskStop` and `ListAgents`. The first four are in `sdk-tools.d.ts`. `ListAgents` is the canonical name the SDK's alias map gives `ListPeers` (`sdk.mjs`: `ListPeers:"ListAgents"`).
3. A `PreToolUse` hook callback asks one domain rule, `pollRefusal(toolName, input)` in `packages/domain/src/rules/poll-refusal.ts`. It refuses a Bash or Agent call with `run_in_background: true`; a Bash command that is only `sleep`, only `true`, a `ps` read of a process, or a `sleep` before a status read; `gh run watch` and `gh pr checks`; and a read of a background task's output file. The reason starts with the fixed text "plot: poll refused" and says: "end your turn with `next: checks` or `next: pushed`; the loop runs the checks and waits for CI". The rule decides and the adapter carries the answer out, so the 100% domain coverage gate covers every shape.

Parts 1 and 2 are the gate: the model cannot start what it would poll. Part 3 refuses a background start on its own, without the environment, and refuses the poll shapes that need no background start (a `sleep` loop around `gh pr checks`). A foreground Bash call stays allowed. Its own limit is 600,000 ms (10 min) in the CLI, and a check longer than that is the reason for `next: checks`.

**A settings file cannot remove part 1.** The CLI applies a settings file's `env` key to its own environment, and `settingSources` loads the user, project and local settings, which `agentSettingsRefusal` does not judge. So before each run the adapter reads the `env` key of `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`, and a rule, `backgroundSwitchRefusal(envs)` in `packages/domain/src/rules/agent-run-env.ts`, refuses the run when any of them names `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. The run then ends `unstarted` with the reason, which names the file and the key. Part 3 still refuses a background start where a source the adapter does not read (a managed policy) sets the variable.

**The prompt states the protocol.** In SDK mode the loop reads the worker prompt as text, from `.plot/worker-prompt.md` when the project has one, and otherwise from the shipped `skills/plot/templates/worker-prompt.md`, which it logs once. Slice 2 writes both files:

- `skills/plot/templates/worker-prompt.md` carries the generic text of `skills/plot/templates/worker-prompt.sh`'s prompt, with the placeholders `{branch}`, `{brief}` (the brief's path) and `{scripts}` (Plot's script directory). It drops "run every test in the FOREGROUND and never end a turn waiting", because the gate holds that now.
- This repository's `.plot/worker-prompt.md` carries the project text of `.plot/worker-prompt.sh:186` (changesets, no generated board bundle in a diff, `trash` and not `rm`, the PR number appended on main), with the same drop.

The adapter appends the `next` protocol paragraph to either text. The protocol is Plot's contract with the loop, so a project file cannot drop it. A project's `.sh` and `.md` hold the same project text for two runners. That is a declared duplicate, stated in both files' headers, and `skills/plot-dispatch/SKILL.md`'s prompt check names the `.md` when `Agent runner` reads `sdk`. No install step is added: an absent `.md` reads the shipped text. The capability mapping stays the project's: the `.md` front matter holds `read-only-deny`, default `Write, Edit, NotebookEdit, Bash, Agent, Task`, the same default as `PLOT_READ_ONLY_DENY`, and a charter's `read-only` capability maps to that list in `disallowedTools`.

**Settings and the context cap.** The SDK adapter passes `settingSources: ['user', 'project', 'local']`, so `CLAUDE.md` and Plot's plugin with its four gates load as they do for `claude -p`. It passes `settings` as an object: the project's `Agent settings` file, judged by `agentSettingsRefusal` as today, plus `autoCompactWindow`. So the SDK run keeps the 2026-10-05 cap, as a setting and not as an environment variable. The `command` runner keeps the `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` prefix in its command strings.

**The charter wins over a config key.** A charter is an Agent fact that a person wrote for one agent; a `## Plot Config` key is a project default. So a worker run reads its harness, model and effort from its charter (`charter.ts:104-118`, which reach the run as `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT` today), then the `worker` entry of `Agent models`, then the model its `Worker command` sets (`PLOT_MODEL=sonnet` in this repository's config, read through the same `fragmentModel` reading the board roles use), then the CLI's default. So a worker keeps the model its command names today, with no config edit. A charter that names a prompt file (`charter.ts:106`) wins over `.plot/worker-prompt.md` on the SDK runner, as it does on `command`. The SDK runner runs only a charter whose harness is `claude` or unstated; a charter that names another harness runs on `command`, logged once. The context cap is `Agent context window` (default 200,000); a charter with a stated `bounds.contextWindow` caps it at that value, because compaction above a window the person declared cannot happen. The charter's `contextCeiling` keeps its meaning: it is the fraction past which Plot calls the agent spent, read against the compacted context. A board role has no charter: it reads its `Agent models` entry, then the `--model` value in its configured command fragment (`fragmentModel(fragment)` reads that one flag), then the CLI's default. So a board role keeps the model its fragment names today, with no config edit.

**Resume or fresh.** A `checks` result and a CI correction resume the session (`resume: sessionId`). Its context is cached, so a resumed turn within the cache's hour reads it at 1/10 weight. A resume after a CI wait near `Checks wait` (3600 s) can find the cache expired and write it again, at most `autoCompactWindow` tokens. A fresh session would re-read the brief and the diff, and it would lose the reasoning behind the commits it is asked to fix. A fresh session starts in two cases, both from the supervisor: a spent correction budget, as `a-spent-correction-budget-gets-a-fresh-agent` decides, and a `turn-limit` ending (slice 3). In SDK mode a fresh session is a run with no `resume`, with the composed answer as its prompt.

**Limits, as config keys with defaults.**

| Key | Applies to | Default when absent | Ending |
|---|---|---|---|
| `Agent max turns` | one run (`maxTurns`) | 150 | `turn-limit` |
| `Agent max spend` | one run (`maxBudgetUsd`) | none | `spend-limit` |
| `Slice max runs` | every run of one slice | 12 | `run-limit` |
| `Slice max spend` | the summed cost of one slice | none | `spend-limit` |
| `Agent context window` | one run (`settings.autoCompactWindow`) | 200000 | none: the CLI compacts |

- **`Agent max turns`.** Runs split at `checks` and `pushed`, so a run holds fewer turns than today's one session per slice. 150 is above every healthy day's mean (23 on 2026-09-30, 142 on 2026-10-02) and under the runaway day (384 on 2026-10-04). Slice 5 reports the per-run turn distribution, and the default is changed there if it is wrong.
- **`Slice max runs`.** The loop counts every run it starts for the slice: the first run, each `checks` resume, each CI correction. It keys the count to the branch and resets it on a hop, as `correctionAttempts` is keyed (#1285). Before each run, `runLimitRefusal(runs, limit)` in `packages/domain/src/rules/run-limit.ts` decides; at the limit the loop starts no run and ends `run-limit`. The default holds the `Correction budget` (2 on this repository) and leaves 9 local-check rounds, while a healthy slice takes 2 to 4 runs. A fresh session is a new agent and starts its count at 0, and a slice gets at most one fresh session, so a slice runs at most twice the limit. Plot can know a count and cannot know a dollar figure, so this is the default bound per slice.
- **The spend limits.** A spend default in dollars depends on the account's plan, which Plot cannot know, so neither key has one. `Agent max spend` bounds one runaway run. `Slice max spend` bounds the slice: before each run, `sliceSpendRefusal(read, limit)` in `packages/domain/src/rules/` reads the slice's cost from `readSpend` (below), and at the limit the loop starts no run and ends `spend-limit`.

**Which ending gets a fresh session.** `turn-limit` is a run whose session grew too long, and a fresh session with a short prompt is the fix, so it gets one. A new rule, `freshAgentAfterTurnLimit(readings)` in `packages/domain/src/rules/`, answers `start-fresh` for `turn-limit` when the slice had no fresh session, and `needs-a-person` otherwise. It reads the same fresh-session count (`.plot/state/fresh-agents.tsv`) as `freshAgentAfterCorrections`, so a slice gets one fresh session in total. `spend-limit` and `run-limit` go to a person: a fresh session would read the same slice spend or start a new count against the same work, and a person decides whether to spend more. `freshAgentAfterCorrections` of `a-spent-correction-budget-gets-a-fresh-agent` does not change.

**Spend lands in the records the supervisor already reads.** The slice-spend record gains a second line kind. `SliceSpendSchema` in `packages/domain/src/entities/slice-spend.ts` becomes a union of the seal line (unchanged, so the lines on disk still decode) and a run line:

`{ kind: 'run', branch, at, sessionId, role, models: { [model]: { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUsd } }, costUsd, turns }`

The run line holds the session's CUMULATIVE figures as the SDK reports them (`modelUsage`, `total_cost_usd`), never a sum the writer computed, and `turns` is the turns of this run. The token counts keep the four-key contract of `TokenCountsSchema`, per model. Each SDK result appends one run line through `SliceSpendRecord.append`; the port's doc changes from "written once per slice" to "one seal line per seal, one run line per run".

**A reader derives the spend, and nothing counts twice.** `readSpend` in `packages/domain/src/rules/slice-spend-record.ts` groups a branch's run lines by `sessionId`, in file order. A session's spend is the sum of its increases: each line adds its value minus the previous line's, and a line lower than the previous one (a counter reset) adds its own value. A line whose counters and cost are all zero is a run that did not start (the SDK writes a zeroed result then, `sdk.d.ts:5698`): it adds nothing and does not become the previous line, so lines of $10, $0 and $15 read $15. A resumed session's second line therefore adds only what the second run spent. The branch's spend is the sum over its sessions plus its newest seal line, and the seal line covers only the sessions without run lines (below). `readSpend` returns the per-model totals, the cost and the run count beside `latest` and `history`, and `planSpend` in `rules/plan-spend.ts` sums those totals per branch in place of `latest.tokens`. An older Plot decodes a run line as `unreadable` and counts it, never as a number.

**The run lines replace the seal's transcript line for their sessions.** A transcript is named by its session id, so the seal reads only the desk sessions that have no run line. A slice that ran only on the SDK gets no seal line, a slice that ran only on `command` gets the seal line as today, and a slice that changed runner gets one seal line for its `command` sessions. Run lines include subagents and compaction, which the seal line excludes (`ports/slice-spend.ts:48-55`), so the board's plan cost changes definition at the runner switch, and the board says so beside the figure.

**Usage-limit readings land in the budget record.** Each `rate_limit_event` appends one `BudgetEntry` through `BudgetRecord.append`, mapped by `rateLimitEntry(info, account, at)` in `packages/domain/src/rules/`: key `{ connector: 'claude', account, bucket: rateLimitType ?? 'unknown' }`, `spent: 0` (a reading, not a call), `limit: 1`, `remaining: 1 − utilization`, or `0` when `status` is `rejected`, `resetAt: resetsAt` in epoch milliseconds, `basis: 'actual'`. `account` is `accountInfo().email`, else `organization`, else `unknown`. The entity does not change. Slice 3's fixture is a recorded live event, which fixes the scale of `utilization` and `resetsAt`. An API-key account sends no event and writes no entry, and the usage-limit path then reads the run's end as above.

**One writer per line, and a decision reads the record.** The run that produced a line writes it. The supervisor, the loop's limit checks and the board read the records, never the SDK and never a live session (A Decision Reads The Index). The records hold answers (the SDK's cumulative figures); the spend per slice is a verdict that `readSpend` derives on each read.

**The config contract.** Today `Worker command`, `Idea command`, `Story command`, `Brief command`, `Implement command`, `Interrogate command`, `Approve command` and `Deliver command` are shell fragments that an adopting repository writes. They stay, and they keep their meaning for the `command` runner. One new key chooses the runner, and one rule, `runnerChoice(readings)` in `packages/domain/src/rules/runner-choice.ts`, answers per role:

- `Agent runner: command` runs the configured fragment, as today.
- `Agent runner: sdk` runs the SDK adapter. The fragment still decides whether the role is configured: a role whose key is absent or `none` refuses as it does today. A worker under `Worker loop: shell` cannot run on the SDK, because SDK mode lives in the JS loop: the `dispatch` and `continue` controllers refuse to start that worker, with the reason "`Agent runner: sdk` needs `Worker loop: js`; set `Worker loop: js`, or set `Agent runner: command`". The board roles run on the SDK under either loop.
- Absent: `command` until slice 5. From slice 5 a role reads `sdk` only when the project already names `claude` for it: for a board role, the first command word of its fragment, after any `NAME=value` prefixes, is `claude`; for the worker role, `Worker loop` reads `js` and the charter's harness is `claude` or unstated. Otherwise it reads `command`, and the rule's reason is logged once. The presence of `claude` on `PATH` decides nothing.

So the default derives from what the project wrote, as `MANIFESTO.md` Principle 5 asks: Plot discovers and adapts, and a project on another harness keeps `command` with no config edit. `Agent models` is one `role = model` list in the form of `Local checks`, for example `worker = sonnet; idea = opus; brief = sonnet`, read with the precedence above. Plot names no model.

**Which agent starts move.** Eleven sites start an agent today. Ten move to the port; one stays.

| Site | Key | Runner after this plan | Slice |
|---|---|---|---|
| the JS loop's prompt run (`plot-worker-loop.mjs`) | `Worker command`, via the charter | `agentRun` | 2 |
| `idea.ts:711`, `commission.ts:407`, `reslice.ts:464`, `deliver.ts:550` | `Idea command` | `agentRun` | 4 |
| `story.ts:504` | `Story command` | `agentRun` | 4 |
| `brief-ask.ts:116` | `Brief command` | `agentRun` | 4 |
| `implement.ts:233` | `Implement command` | `agentRun` | 4 |
| `interrogate.ts:321` | `Interrogate command` | `agentRun` | 4 |
| `approve.ts:373` | `Approve command` | `agentRun` | 4 |
| `auto-deliver.ts:432` | `Deliver command` | `agentRun` | 4 |
| `plot-dispatch.sh:571` (`brief_command`) | `Brief command` | `command` | none |

`continue.ts:563` and `plot-dispatch.sh`'s worker start run `Worker command`, which starts the worker LOOP and not an agent. The loop's prompt run is the agent start, and it moves in slice 2. `plot-dispatch.sh`'s brief start stays on `command`: an SDK start from bash needs a JS entry and a bundle that carries the SDK, and this plan adds neither to the shell. `the-shell-shrinks-into-the-domain` moves that start; until then the board's `brief-ask.ts` is the SDK path for a brief.

**The shell does not grow.** SDK mode lives in TypeScript. `.plot/worker-prompt.sh` and `.plot/worker-prompt.md` are outside `skills/`, and `plot-install-prompt.sh` does not change. Each slice runs `scripts/check-shell-lines.sh pr`. Slice 4 sets the spawn ratchet's `allowed` (*One place reaches a process*, `ci.yml:661`, `allowed=28`) to the count it measures after the move.

**The dependency.** `@anthropic-ai/claude-agent-sdk` 0.3.289 declares peer dependencies `zod ^4.0.0` (the domain has `^4.4.0`), `@anthropic-ai/sdk >=0.93.0` and `@modelcontextprotocol/sdk ^1.29.0`. Its `sdk.mjs` is 1,214,390 bytes. Slice 2 adds it to `packages/domain` and proves that esbuild bundles it into `plot-worker-loop.mjs` with the platform packages excluded. Slice 4 does the same for `board-server.mjs` (1,226,300 bytes today). Each of the two PRs records the bundle's size before and after, and a test asserts that `plot-registryd.mjs` and the other bundles do not contain the SDK.

**Interaction with other plans.**

- `the-worker-loop-runs-in-js`: slice 2 waits on its slice 3, `infra/the-loop-runs-in-one-process`, because the JS loop must exist to own the waiting. Slice 5 waits on its slice 5, `infra/js-is-the-default-loop`, because the SDK default reaches a worker only where the JS loop runs. That plan does not change. The SDK run replaces the prompt run that its `boundedRun` carries, behind `Agent runner`; `boundedRun` stays for the local checks. Its `--self-check` arrives with `infra/the-loop-restarts-on-new-code`, and from then it covers the SDK in the bundle; this plan does not rely on it.
- `the-build-monitor-asks-for-the-pushed-commit` (#1286, merged): the loop's CI wait reads `BuildPort.runForSha`, which answers only for the asked commit.
- `a-spent-correction-budget-gets-a-fresh-agent`: slice 3 adds `freshAgentAfterTurnLimit` beside its `freshAgentAfterCorrections`, shares its fresh-session record and its registry tick's continue, and waits on its branch. Its rule does not change.

**Tests.**

- `pollRefusal`: each measured shape refused (`true`, `sleep 60`, `sleep 30 && gh pr checks`, `gh run watch`, `ps -p 123`, `cat` of a task output file, `run_in_background: true` on Bash and on Agent), and a foreground `pnpm test` allowed.
- `agentRunEnv`: `PATH`, `HOME` and each `PLOT_*` name of the input reach the output, and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` reads `1`. `backgroundSwitchRefusal`: a project settings file whose `env` sets the variable to `0` refuses the run and names the file.
- `sdkRunExit`: one row per line of its table, including a rejected `rate_limit_event` on a run that also handed back `done`, which answers the limit and not `ran`.
- `agentLoop`'s hand-back rows: `checks`, then a pass, then `pushed`, gives two model runs and no model turn between them; `checks` with a fail resumes with the failing command and its tail; no `structured_output` reads the desk; the run at `Slice max runs` is not started.
- The SDK adapter against a fixture `spawnClaudeCodeProcess` that replays recorded stream-json: the options it passes, the env the child receives, the run line and the budget entry it writes, and the bound's abort reaching the child's descendants.
- `readSpend`: two run lines of one resumed session give the second run's increase once; a counter reset adds the new value; a record that holds a seal line and run lines for one branch gives the right total.
- The group stop of `plot-dispatch.sh --stop` ends the loop and `claude` (#1084), as slice 2 of `the-worker-loop-runs-in-js` proves for `boundedRun`.

### Open Questions

- [ ] **The scale of `utilization` and `resetsAt`.** `sdk.d.ts` types both as `number` and states no unit. Slice 3 records one live `rate_limit_event` as its fixture and fixes the mapping from it.
- [ ] **The per-run turn distribution.** The 150 default is set from per-session means. Slice 5's script reports turns per run on the SDK runner, and the default changes there if the distribution shows it is wrong.

## Slices

### An agent run is a port

- `infra/an-agent-run-is-a-port` — the `agentRun` port and its fixture adapter; `pollRefusal`, `agentRunEnv`, `backgroundSwitchRefusal`, `sdkRunExit` with `limitAnswer` extracted from `promptExit`, `runLimitRefusal`, `runnerChoice` and `fragmentModel`; the `next` hand-back rows in `agentLoop`; the endings `turn-limit`, `run-limit` and `spend-limit`; all in `packages/domain`, with no SDK dependency → #1293 <!-- builds: agentRun, the agent-run connector port -->

### The loop waits, the model does not

- `infra/the-loop-waits-not-the-model` — the SDK connector and the command adapter; the JS loop runs its prompt through `agentRun`, runs the local checks on `next: checks` and resumes with the result; `Agent runner`, `Agent models`, `Agent max turns`, `Slice max runs` and `Agent context window`; the `dispatch` and `continue` refusal for `sdk` under `Worker loop: shell`; `skills/plot/templates/worker-prompt.md` and this repository's `.plot/worker-prompt.md`; the SDK in `plot-worker-loop.mjs`; default `command` → #1321 <!-- builds: the SDK connector in the worker loop --> <!-- waits: infra/an-agent-run-is-a-port --> <!-- waits: infra/the-loop-runs-in-one-process -->

### A run records its spend and its limits

- `infra/a-run-records-its-spend` — the run line in `SliceSpendSchema`, `readSpend` and `planSpend` that sum session increases, the seal that skips sessions with run lines; `rateLimitEntry` into the budget record; `Agent max spend`, `Slice max spend` with `sliceSpendRefusal`; `freshAgentAfterTurnLimit` and the supervisor's one fresh session for `turn-limit` <!-- builds: the per-run spend line and the turn-limit fresh session --> <!-- waits: infra/the-loop-waits-not-the-model --> <!-- waits: feature/a-spent-correction-budget-gets-a-fresh-agent -->

### The board runs through the port

- `infra/the-board-commands-run-through-the-port` — the ten board routes in the table above start their agent through `agentRun`, each with its hand-back schema; the SDK in `board-server.mjs`; the spawn ratchet set to the measured count <!-- builds: the board's agent starts through agentRun --> <!-- waits: infra/the-loop-waits-not-the-model -->

### The SDK is the default runner

- `infra/the-sdk-is-the-default-runner` — `scripts/count-fleet-turns.mjs` measures both runners; an absent `Agent runner` reads `sdk` where `runnerChoice` finds `claude` named, after the bar below <!-- builds: count-fleet-turns.mjs and the sdk default --> <!-- waits: infra/js-is-the-default-loop --> <!-- waits: infra/a-run-records-its-spend --> <!-- waits: infra/the-board-commands-run-through-the-port -->

## Done When

**Slice 1.** All of these hold:

- `pollRefusal`, `agentRunEnv`, `backgroundSwitchRefusal`, `sdkRunExit`, `runLimitRefusal`, `runnerChoice` and `fragmentModel` have the tests in Tests, and the domain's 100% coverage gate passes over them.
- `promptExit`'s existing tests pass unchanged after `limitAnswer` is extracted.
- The fixture-adapter test shows: a run that hands back `checks` and then `pushed` costs two model runs, and the loop runs the checks and the CI wait with no model turn between them.
- `agentRunEnv`'s test fails for an output that lacks `PATH`, `HOME` or a `PLOT_*` name of the input.
- `runnerChoice` answers `command` for a fragment whose command word is not `claude`, for a charter that names another harness, and for a worker under `Worker loop: shell`, whatever `PATH` holds.

**Slice 2.** All of these hold:

- The adapter's fixture test shows the options it passes: an `env` that holds the parent's `PATH`, `HOME` and `PLOT_*` names and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, the five `disallowedTools`, the `PreToolUse` callback, `settingSources`, `autoCompactWindow` capped by a charter's window, the charter's model and effort, and a spawn without `detached`.
- A fixture project whose `.claude/settings.json` sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` ends the run `unstarted` with the file named.
- The `dispatch` controller refuses a worker on `Agent runner: sdk` under `Worker loop: shell`, with the reason, in a test.
- A test imports the built `plot-worker-loop.mjs` and runs one fixture run through its SDK path.
- The group-stop test ends the loop and `claude` on Linux in CI, and the PR records a macOS run of it.
- `scripts/check-shell-lines.sh pr` reports no growth.
- **After merge, an operator step.** The operator sets `- **Agent runner:** sdk` in this repository's `## Plot Config`, in its own commit; slice 5's SDK window starts at that commit. The first live slice on it includes at least one `checks` hand-back and one CI wait, and its PR records 0 completed polls, the refused polls, the turns per run and the peak context.

**Slice 3.** All of these hold:

- An SDK run appends one run line, and each `rate_limit_event` appends one budget entry, both shown by a test against the file adapters.
- `readSpend` and `planSpend` pass the three `readSpend` cases in Tests, and a slice with one `checks` resume and two corrections reads its cost once.
- A session whose run lines read $10, $0 and $15 reads $15: a zeroed line adds nothing.
- A sealed SDK slice has run lines and no seal line, a sealed `command` slice has its seal line, and a slice that changed runner has one seal line for its `command` sessions only, each with a test.
- A run that ends `turn-limit` gets one fresh session from the registry tick and no second one; a slice whose cost reaches `Slice max spend` starts no next run and ends `spend-limit` with no fresh session (tests at 100% domain coverage).
- `freshAgentAfterCorrections`'s tests pass unchanged.

**Slice 4.** `git grep -nE "spawn\(" -- packages/board/src/server/{idea,commission,reslice,deliver,story,brief-ask,implement,interrogate,approve,auto-deliver}.ts` lists no match. The spawn ratchet's `allowed` equals the count the CI grep measures after the move. Each route's existing tests pass on both runners. On the SDK runner each role hands back its schema, and a test shows that a run naming no file, or a missing file, ends as a failed run with its reason. A test shows that a board role with no `Agent models` entry runs on the model its fragment's `--model` names. The PR records `board-server.mjs`'s size before and after.

**Slice 5.** `scripts/count-fleet-turns.mjs` reports, per day and per runner, the four columns of Motivation's table, weighted tokens per sealed slice, turns per run, completed polls and refused polls. A refused poll is a tool call whose result carries "plot: poll refused"; every other polling call is completed. It classifies `true`, `sleep`, task-output `cat`, `ps`, `ScheduleWakeup`, `ListAgents` and CI reads. The default flips when all of these hold:

- The baseline is the sealed `command` slices of this repository on the JS loop (`Worker loop: js`) between the later of c172910a8 (the 200k cap) and the merge of `infra/js-is-the-default-loop`, and the commit that sets `Agent runner: sdk`, at least 20 slices. Both windows run the JS loop under the cap, so the runner is the only change between them. The SDK window is the next 20 or more sealed slices on `sdk`.
- In each of two size groups, by the slice's diff (at most 200 changed lines, more than 200), with at least 5 slices per group on each side, the median weighted tokens per sealed slice on `sdk` is at most 85% of the baseline's.
- The SDK window shows 0 completed polls.
- The share of SDK slices that end at a person is at most the baseline's share.

The PR names the slices it counted on both sides and the figures. The median peak context is reported and is not a condition, because `autoCompactWindow` sets it.

## Notes

- 2026-10-05, direction from jwloka: every fleet agent run moves to the Claude Agent SDK, the worker loop's prompt run and the board-launched commands. Its own plan, which waits on slice 3 of `the-worker-loop-runs-in-js`; that plan stays unchanged. The requirement: "The loop, not the model, waits for CI and for background tests. No turn is spent re-reading 400k to ask 'done yet?'."
- 2026-10-05, measurement: Motivation's table and the polling counts come from the transcripts under `~/.claude/projects/` for this repository; a cache read counts 1/10. Slice 5's script repeats the method in the repository.
- 2026-10-05, SDK read: `@anthropic-ai/claude-agent-sdk` 0.3.289 (`npm pack` from `registry.npmjs.org`), `sdk.d.ts`, `sdk-tools.d.ts` and the alias map in `sdk.mjs`. The CLI on this machine reads 2.1.289, the version the package's `manifest.json` names.
- 2026-10-05, decisions from jwloka in review: the Artifactory proxy serves `@anthropic-ai/claude-agent-sdk` (fixed the same day); a slice gets its own spend limit, `Slice max spend`; the board's runs hand back what they wrote through `outputFormat`; `Agent max turns` defaults to 150; the per-run spend lines replace the seal's transcript line.
- 2026-10-05, after panel round 1, jwloka kept the SDK over `claude -p` flags; the cost juror's measurement (waiting 11-18% of spend, ~80% ordinary work above 200k) is recorded in the panel.
- 2026-10-05, panel round 1 (`.plot/panels/2026-10-05-fleet-agents-run-through-the-agent-sdk/`): unanimous `amend`. The amendment merges the child env, defines run lines by session with a reader that sums increases, names real prompt files, makes the default derive from the project and wait on the JS default loop, adds `Slice max runs`, maps every SDK run end, gives `turn-limit` alone a fresh session through a new rule, lists all eleven agent starts, lets the charter win, splits the domain work into its own slice, and restates slice 5's bar against a cap-only baseline.
- Deliverable search, 2026-10-05: `plot-deliverable-search.sh` found no existing deliverable for `agentRun`, `agent-run`, `pollRefusal`, `turns-spent`, `Agent runner`, `Agent models`, `Agent max turns`, `count-fleet-turns`, `outputFormat`, `autoCompactWindow` or `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. The nearest names are the `Agent-runner keys` comment group in `plot-config.sh:106` (the existing command keys, which this plan keeps) and `entry/slice-spend.ts` (the existing seal-time spend entry, which slice 3 changes to skip sessions with run lines).
- 2026-10-05, panel round 2 (`verification-round2.md`): `proceed`. Its four MEDIUM findings are fixed: a zeroed run line adds nothing to `readSpend`, a worker keeps the model its `Worker command` sets, a charter's prompt file wins on the SDK runner, and slice 5's baseline runs on the JS loop so only the runner differs. jwloka kept `Slice max runs` 12 and the 85% margin.
