# Panel — fleet-agents-run-through-the-agent-sdk

- **Round:** 1, 2026-10-05
- **Reconcile:** unanimous `amend` (estate, contradiction, deliverable, cost)
- **Gate:** all four verdict files committed a position (`plot-panel.mjs check`, exit 0)

## Findings more than one juror holds

| Finding | Jurors | Evidence |
|---|---|---|
| The SDK `env` option replaces the CLI child's whole environment, so `{ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }` drops PATH, HOME, credentials and the `PLOT_*` variables, and the plugin gates fail open. Slice 1's Done-when passes on the broken object. | estate, contradiction | `sdk.d.ts:1645-1646`; `agent-settings.ts:112` |
| Per-run spend lines double-count: a resumed session's `modelUsage` and `total_cost_usd` already include the earlier runs, and the plan resumes after every `checks` and every correction. `SliceSpendSchema` is `.strict()` with no field for the new line, and the reader takes the newest line, not a sum. | estate, contradiction, deliverable | `sdk.d.ts:5679`, `:5781`, `:5789`; `entities/slice-spend.ts`; `rules/slice-spend-record.ts:84`; `plan-spend.ts:93` |
| The prompt templates the plan names (`skills/plot-dispatch/templates/worker-prompt.md`, `.plot/worker-prompt.md`) do not exist, and no slice writes them. | estate, contradiction, deliverable | `ls` of both paths |
| Slice 4's SDK default cannot reach workers: SDK mode exists only in the JS loop, `Worker loop` stays `shell` until `infra/js-is-the-default-loop`, and slice 4 does not wait on it. `Worker loop: sh` with `Agent runner: sdk` is undefined. | estate, contradiction, deliverable | `the-worker-loop-runs-in-js.md:123`, `:178`, `:203` |
| Nothing bounds the number of runs per slice by default: `checks` resumes are uncounted, and every limit applies per run. | contradiction, deliverable, cost | plan §Limits |
| An SDK run's end has no mapping to the loop's prompt-exit answers (`wait`, `end-limited`, `unstarted`, `ran`) or the `limited` ending, so a usage-limit stop reads as `done` and restarts into the same limit. | estate, deliverable | `prompt-exit.ts:6`, `:138` |

## Findings one juror holds

- **cost:** waiting turns are 11-18% of 394M weighted tokens since 2026-10-02; about 80% is ordinary work, and 77-94% of each day's spend runs above 200k context. The 200k cap (c172910a8) targets that share and works on `claude -p`; it is unmeasured (one session since, peak 196k). `claude -p` already has `--json-schema`, `--max-budget-usd`, `--resume` and `--disallowedTools`, so most of slice 1's saving needs no SDK. Slice 4's bar holds by construction and has no `command` slices to compare against. 57% of spend comes after turn 150.
- **contradiction:** an SDK default whenever `claude` is on PATH contradicts `plot-config.sh:106` (Principle 5, no hardcoded agent tooling) and ignores the charter's `PLOT_HARNESS`. `Slice max spend` stops every run, so the promised fresh session after `spend-spent` ends at once; reusing `freshAgentAfterCorrections` changes an approved plan in flight. A refused poll still appears in the transcript, so "0 polling calls" cannot hold.
- **estate:** "every fleet agent run" covers 7 of 11 agent starts; `deliver.ts:550`, `approve.ts:373`, `auto-deliver.ts:432`, `continue.ts:563` and `plot-dispatch.sh:571` are left out. `Agent models` and `Agent context window` overlap the charter's model, effort, harness and context bounds (`charter.ts:104-118`) with no precedence stated. `--self-check` arrives in slice 4 of the JS loop plan, not slice 3.

## What the lenses shared

All four jurors read the plan and the code; the cost juror re-measured transcripts, and the contradiction and estate jurors read SDK 0.3.289's `.d.ts`. No juror ran the SDK or a `claude -p --json-schema` turn, so the claim that `claude -p` flags give the same hand-back is read from `--help`, not tested. No juror measured the 200k cap, because one session has run since it landed. Both are open facts, not findings.

## The decision this panel leaves to the caller

The cost juror's finding questions the runner choice itself, which the operator made before this measurement existed. The other findings amend the plan under either runner.
