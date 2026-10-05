# Verification juror, round 2: fleet-agents-run-through-the-agent-sdk

Position: proceed

Lens: VERIFICATION. Each round-1 HIGH and MEDIUM is checked against the amended Draft (uncommitted, 291 lines), against origin/main at `ce7279889`, and against SDK 0.3.289 at `/Users/jwloka/.claude/jobs/ca0ab00d/tmp/sdk-types/package/`. `proceed` follows the panel's definition: every round-1 HIGH and MEDIUM has an answer in the plan, and no new finding is HIGH. Four new MEDIUM findings remain. They are cheap to fix and belong in the plan before the briefs are written.

## Round-1 findings

| Round-1 finding | Verdict | Evidence |
|---|---|---|
| estate H1 / contradiction H4: `env` replaces the child environment | answered | §"The child keeps its environment" passes `{ ...process.env, ...request.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }` through `agentRunEnv`. Slice 1 and slice 2 Done-when fail on an output that lacks `PATH`, `HOME` or `PLOT_*`. `sdk.d.ts:1645-1650` confirms REPLACE semantics. |
| estate H2 / contradiction H1 / deliverable M1: resumed sessions double-count, and the schema is strict | answered with a new problem (N1) | §"A reader derives the spend" sums per-session increases. `SliceSpendSchema` becomes a union. The mixed seal-plus-run record has a Tests row. The zeroed startup result of `sdk.d.ts:5698` breaks the reset rule (N1). |
| estate H3: 11 agent starts, plan covered 7 | answered (count slip, L1) | The §"Which agent starts move" table lists all ten route files. `git grep -nE "spawn\(\|execFile\("` over those ten files on origin/main gives exactly 10 hits, one per file. `continue.ts:563` starts `Worker command` (the loop). This is correct and stated. `plot-dispatch.sh:571` stays, with a reason. |
| estate H4 / contradiction M5: charter vs `Agent models`, two windows | answered with a new problem (N2, N3) | §"The charter wins over a config key" orders charter, then `Agent models`, then the CLI default. `bounds.contextWindow` caps `autoCompactWindow`, and `contextCeiling` keeps its meaning. The worker's model in this repository does not come from a charter (N2), and the charter's `prompt` field is not read (N3). |
| estate M1 / contradiction M4 / deliverable H3: prompt files do not exist | answered with a new problem (N3) | Real paths: `skills/plot/templates/worker-prompt.md` and `.plot/worker-prompt.md`, both written in slice 2. The plan declares the duplicate. `skills/plot-dispatch/SKILL.md:212` holds the prompt check the plan extends. The capability mapping moves to `.md` front matter. |
| estate M2 / contradiction M7 / deliverable H1: `--self-check`, `Worker loop: shell`, slice 4 not waiting | answered | Slice 5 has `waits: infra/js-is-the-default-loop`. The `--self-check` claim is dropped (§Interaction). `sdk` under `shell` is refused by the `dispatch` and `continue` controllers, with the reason. JS plan `:123` confirms that the launcher reads `Worker loop`. |
| estate M3 / contradiction M6: budget entry mapping | answered | `rateLimitEntry` maps `spent: 0`, `limit: 1`, `remaining: 1 − utilization`, `resetAt` in ms and `basis: 'actual'`, and the entity is unchanged. `BudgetKey` fields are `z.string()` (`entities/budget.ts:25-27`), so `connector: 'claude'` fits. `resetAt` is epoch ms (`:51`). The unit of `utilization` stays an Open Question, fixed from a live fixture. |
| estate M4 / deliverable M6: `spend-spent` next to `spent` | answered | Renamed to `turn-limit`, `spend-limit` and `run-limit`. None of them collides with `EndingReasonSchema` (`entities/ending.ts:96-106`). |
| deliverable H2 / panel: no mapping from SDK end to `PromptExit` | answered | The `sdkRunExit` table puts the rows in order: limit before `ran`, `unstarted` for spawn, startup and zero-turn failures. `limitAnswer` is extracted from `promptExit` (`rules/prompt-exit.ts:76-85` holds `wait`, `end-limited`, `unstarted` and `ran`). A test row covers a rejected event on a run that also handed back `done`. The `TerminalReason` values the plan names all exist (`sdk.d.ts:9685`), as do `startup_failure_reason` (`:5701`) and `terminal_reason` (`:5714`). |
| contradiction H2: `Slice max spend` vs fresh session | answered | `freshAgentAfterTurnLimit` gives a fresh session to `turn-limit` only. `spend-limit` and `run-limit` go to a person. `freshAgentAfterCorrections` stays unchanged, and slice 3's Done-when asserts its tests pass unchanged. |
| contradiction H3: SDK default vs Principle 5 | answered | `runnerChoice` reads `sdk` only where the fragment's command word is `claude`, or for a worker where `Worker loop` is `js` and the charter's harness is `claude` or unstated. "The presence of `claude` on `PATH` decides nothing." |
| contradiction M1 / deliverable M2 / cost H3: no per-slice bound | answered | `Slice max runs` defaults to 12 and counts the first run, each `checks` resume and each correction. `runLimitRefusal` decides, and Tests cover "the run at `Slice max runs` is not started". |
| contradiction M2: "0 polling calls" vs a refused poll | answered (L2) | Slice 5 separates completed polls from refused ones by the fixed text "plot: poll refused". |
| contradiction M3: project settings `env` can undo part 1 | answered (L3) | `backgroundSwitchRefusal` reads the `env` of three settings files and ends the run `unstarted`. Slice 2 Done-when has a fixture. On this machine `~/.claude/settings.json` `env` holds `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and `OMC_SKIP_HOOKS` only, so the operator is not refused. |
| deliverable M3: board roles lose `--model` | answered | `fragmentModel(fragment)` is in the precedence, and slice 4 Done-when tests it. |
| deliverable M4: slice 1 too large | answered | The domain-only slice `infra/an-agent-run-is-a-port` has no SDK dependency and no wait on the loop. |
| deliverable M5: live run is an operator action | answered | Slice 2 has "After merge, an operator step", in its own commit, which starts the window. |
| cost H1: claims a saving the cap already makes | answered with a new problem (N4) | Motivation credits the 200k cap with the larger share. Slice 5's baseline is the cap-only `command` slices after `c172910a8`. |
| cost H2: unfair flip bar | answered with a new problem (N4) | Two size groups with at least 5 slices per side, at most 85% of the baseline median, 0 completed polls, and a person-ending share no higher than the baseline. Peak context is reported and is not a condition. |
| cost M1: turn distribution, turn limit order | answered | `Agent max turns` ships in slice 2 with the loop. Slice 5 reports turns per run. Open Question 2 is declared. |
| cost M2: `claude -p` flags instead of the SDK | out of scope | The operator settled this (Notes, 2026-10-05). |
| cost M3: bundle size, barrel | answered | `agent-run-sdk` is kept out of `adapters/index.ts` (42 exports on origin/main). Only `plot-worker-loop.mjs` and `board-server.mjs` carry the SDK, and a test asserts that the other bundles do not. Both PRs record sizes. |

## New findings

### HIGH

None.

### MEDIUM

**N1. A zeroed result line makes `readSpend` count a resumed session twice.** `sdk.d.ts:5698` names "the zeroed error_during_execution result a stream-json run writes before exiting on a known startup failure", and `:5781`/`:5789` say "crash/startup-error results may carry zeroed values". The plan appends "one run line" per SDK result (§"Spend lands in the records"), including `unstarted` ones. Its reader adds "a line lower than the previous one (a counter reset)" at its own value. Take one session with lines $10, $0 (a resume that failed to start) and $15: the reader adds 10, then 0, then 15 − 0 = 15, so it reads $25 where the session spent $15. The direction is the one round-1 H2 named: `Slice max spend` trips early and the board's plan cost is inflated. Slice 3's Done-when ("a slice with one `checks` resume and two corrections reads its cost once") passes without this case. Fix: write no run line for an `unstarted` end or an all-zero result, and add the 10/0/15 sequence to the `readSpend` tests.

**N2. This repository's workers can move from sonnet to the CLI default with no config edit.** The worker model comes from the `Worker command` fragment: `PLOT_UNATTENDED=1 CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 PLOT_MODEL=sonnet …plot-worker-loop.sh` (CLAUDE.md:58 on origin/main). It does not come from a charter. `plot-dispatch.sh:1561` exports `PLOT_MODEL="$launch_model"`, which is empty without a charter, and the fragment's prefix then overrides it. The plan's worker precedence is "charter, then the `worker` entry of `Agent models`, then the CLI's default". It says only that the charter "reach[es] the run as `PLOT_MODEL`". So an implementer who reads the charter file loses `sonnet`, and slice 2's Done-when tests "the charter's model" only. Board roles got `fragmentModel` for exactly this case (deliverable M3), and the worker role did not. Fix: name `PLOT_MODEL` from the loop's environment as the worker's second source, and add a slice 2 test proving that this repository's worker stays on `sonnet` with no `Agent models` key.

**N3. SDK mode ignores the charter's `prompt`.** `CharterSchema` requires `prompt` ("The prompt file this agent runs, relative to the repo root", `entities/charter.ts:106,135`), and the shell loop resolves it through `resolve_prompt_file "$repo_root" "${PLOT_AGENT:-}"` (`plot-worker-loop.sh:1874`). The plan's SDK prompt is `.plot/worker-prompt.md`, else the shipped `.md`. It never names the charter's prompt, while §"The charter wins over a config key" claims the charter wins. A chartered agent on `sdk` runs the project's generic prompt with no log line. Fix: state what the SDK runner does with a charter's `prompt` (read a `.md` beside it, or run that charter on `command`, logged once, as for a non-`claude` harness), with a `runnerChoice` row.

**N4. The two plans' measurement windows overlap, so each flip compares a mix of changes.** The JS plan's slice 5 measures `js` slices from the commit that sets `Worker loop: js` (`the-worker-loop-runs-in-js.md:187`, `:203`). This plan's operator step sets `Agent runner: sdk` after slice 2. That can happen inside the JS window, so the JS plan's failure-rate comparison then includes SDK slices. This plan's baseline ("sealed `command` slices … between c172910a8 and the commit that sets `Agent runner: sdk`") mixes shell-loop and js-loop slices, so the 85% bar measures loop and runner together. The plan says the other plan "does not change" and does not order the windows. Fix: set `Agent runner: sdk` only after the JS plan's slice 5 window closes, or take the baseline only from `command` slices on `Worker loop: js`, and state which one.

### LOW

**L1. Site count.** §"Which agent starts move" says "Eleven sites start an agent today. Ten move to the port; one stays." The table holds 12 sites: the loop, ten routes and `plot-dispatch.sh:571`. So 11 sites move.

**L2. Poll classifier vs refusal set.** Slice 5 counts "CI reads" as polls, but `pollRefusal` refuses only `gh run watch`, `gh pr checks` and a `sleep` before a status read. A correction's `gh run view --log-failed` is ordinary work. If the classifier counts it, the "0 completed polls" condition fails on that work. Name the exact shapes the classifier counts, equal to the refusal list.

**L3. `backgroundSwitchRefusal` refuses a settings file that sets the variable to `1`.** The plan refuses any file that names `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, while only a falsy value undoes part 1. Refusing `1` is stricter than needed. State it, or refuse only a value other than `1`.

**L4. The run count does not reset for a fresh session.** `Slice max runs` is "keyed to the branch", and "a fresh session … starts its count at 0". A fresh session keeps the branch, so the reset needs a stated key (branch plus session or manifest), and slice 3 has no test for it.

**L5. The `Worker loop` key has a lifetime.** `runnerChoice` reads `Worker loop: js`, and the JS plan's slice 6 removes that key (`:228`). Say what `runnerChoice` reads after that.

**L6. Two context-cap sources reach a worker child.** The `Worker command` prefix `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` reaches the loop's `process.env`, and the adapter spreads `process.env` into the child beside `settings.autoCompactWindow`. The plan states no precedence. Both values are 200000 here, so nothing breaks today.

**L7. `limitAnswer`'s signature omits `now`.** `promptExit` compares the reset with `now` (`PromptExitInput.now`, `prompt-exit.ts:46`). The extracted signature `(reset, boundSeconds, ranSeconds, afterWait, commitsSinceWait)` does not take it.

**L8. Slice 1 Done-when "whatever `PATH` holds".** `runnerChoice` takes readings and no `PATH`, so this clause passes trivially. It is harmless and proves nothing.

## Claims checked true

`sdk.mjs` contains `ListPeers:"ListAgents"`. `autoCompactWindow` is a `Settings` key (`sdk.d.ts:8983`). `outputFormat` exists (`:1975`). The result subtypes are as listed (`:5672`). `rateLimitType`, `resetsAt` and `utilization` are optional on `SDKRateLimitInfo` (`:5647-5650`). `Query.backgroundTasks()` throws under the variable (`:3226-3234`). The spawn ratchet is `allowed=28` at `ci.yml:661`. The fresh-session record is `.plot/state/fresh-agents.tsv` (`2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md:43`). The approve and deliver routes start `claude -p` that inherits the plugin hooks, after a receipt (`approve.ts:367-373`, `auto-deliver.ts:425-432`), which is consistent with `settingSources` loading the plugin.
