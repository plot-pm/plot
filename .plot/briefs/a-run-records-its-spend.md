## Implementation brief — fleet-agents-run-through-the-agent-sdk (wave 3: A run records its spend and its limits)

- **Plan (canonical):** `docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `infra/a-run-records-its-spend` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Both waits have merged: `infra/the-loop-waits-not-the-model` (#1321) and `feature/a-spent-correction-budget-gets-a-fresh-agent` (#1291). Wave 5 (`the-sdk-is-the-default-runner`) waits on this one and on wave 4.

### What to build

**The failure it fixes.** Measured 2026-10-05 from the transcripts: one fleet session spent 384 turns on one slice (2026-10-04), and the loop read it as a running prompt until `Worker bound`. After #1321 an SDK run ends `turn-limit`, `run-limit` or `spend-limit`, but nothing reads those endings and no run leaves a record: `AgentRunResult.usageByModel`, `costUsd`, `turns` and `limitReadings` are returned to the loop and dropped. The supervisor and the board can read neither a slice's cost nor a usage-limit reading. This wave writes both records and gives `turn-limit` its one fresh session.

What lands:

1. **The run line.** `SliceSpendSchema` in `packages/domain/src/entities/slice-spend.ts` becomes a union of the seal line (unchanged, so lines already on disk decode) and `{ kind: 'run', branch, at, sessionId, role, models: { [model]: { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, costUsd } }, costUsd, turns }`. Each SDK result appends one run line through `SliceSpendRecord.append`. Change the port's doc from "written once per slice" to "one seal line per seal, one run line per run".
2. **The reader.** `readSpend` (`rules/slice-spend-record.ts`) groups a branch's run lines by `sessionId` in file order and sums increases; `planSpend` (`rules/plan-spend.ts`) sums the per-branch totals in place of `latest.tokens`. `readSpend` returns the per-model totals, the cost and the run count beside `latest` and `history`. An older Plot decodes a run line as `unreadable` and counts it.
3. **The seal skips sessions with run lines.** `entry/slice-spend.ts` reads only the desk sessions that have no run line. An SDK-only slice gets no seal line, a `command`-only slice gets the seal line as today, and a slice that changed runner gets one seal line for its `command` sessions.
4. **`rateLimitEntry(info, account, at)`** in `packages/domain/src/rules/`. Each `rate_limit_event` appends one `BudgetEntry` through `BudgetRecord.append`: key `{ connector: 'claude', account, bucket: rateLimitType ?? 'unknown' }`, `spent: 0`, `limit: 1`, `remaining: 1 − utilization` (or `0` when `status` is `rejected`), `resetAt: resetsAt` in epoch milliseconds, `basis: 'actual'`. `account` is `accountInfo().email`, else `organization`, else `unknown`. The `BudgetEntry` entity does not change.
5. **`Agent max spend` and `Slice max spend`**, no default for either. `Agent max spend` becomes `maxBudgetUsd` on the run. `sliceSpendRefusal(read, limit)` in `packages/domain/src/rules/` decides before each run from `readSpend`; at the limit the loop starts no run and ends `spend-limit`. Add both keys to the `Agent-runner keys` comment group in `skills/plot/scripts/plot-config.sh` as comment lines.
6. **`freshAgentAfterTurnLimit(readings)`** in `packages/domain/src/rules/` beside `fresh-agent.ts`: `start-fresh` for a `turn-limit` ending when the slice had no fresh session, `needs-a-person` otherwise. It reads the same `.plot/state/fresh-agents.tsv` count as `freshAgentAfterCorrections`, so a slice gets one fresh session in total. The registry tick (`entry/registryd.ts`, `freshAgentDecisions`) calls it and starts the fresh session the way wave `a-spent-correction-budget-gets-a-fresh-agent` does; read `.plot/briefs/a-spent-correction-budget-gets-a-fresh-agent.md` for what it found about `no-manifest` and `agent-resume` with `resumeId: ''`, and reuse that path. In SDK mode a fresh session is a run with no `resume`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**A run line holds the session's CUMULATIVE figures, never a sum the writer computed.** The SDK's `modelUsage` and `total_cost_usd` continue from the totals a resumed session's transcript saved (`sdk.d.ts:5781`, `:5789`). A writer that adds the resumed run's figures to the previous line counts the first run twice. `turns` is the one per-run field.

**The reader sums increases, and a zeroed line adds nothing.** Per session, each line adds its value minus the previous line's; a line lower than the previous one (a counter reset) adds its own value. A line whose counters and cost are all zero is a run that did not start (the SDK writes a zeroed result then, `sdk.d.ts:5698`): it adds nothing and does not become the previous line, so lines of $10, $0 and $15 read $15. Taking the newest line per session instead reads a zeroed run as a refund. The branch's spend is the sum over its sessions plus its newest seal line, and the seal line covers only the sessions without run lines.

**Run lines replace the seal's transcript line for their sessions, and the figure changes definition.** Run lines include subagents and compaction, which the seal line excludes (`ports/slice-spend.ts:48-55`). The board says so beside the plan cost at the runner switch. Do not reconcile the two by scaling one to match.

**The token key set stays four keys, per model.** `TokenCountsSchema`'s contract is the key set: cache reads are 99.36% of a naive total, so a summed fifth field is a cache-read count wearing a cost's name. The test asserts keys, not values.

**`turn-limit` alone gets a fresh session; `spend-limit` and `run-limit` go to a person.** A fresh session would read the same slice spend, or start a new run count against the same work, and a person decides whether to spend more. `freshAgentAfterCorrections` does not change and its tests pass unchanged. A slice gets at most one fresh session in total, whichever rule asked for it.

**The run line is written by the run that produced it, and decisions read the record.** The supervisor, the loop's limit checks and the board read the records, never the SDK and never a live session. The records hold answers; the slice's spend is a verdict `readSpend` derives on each read, and nothing persists it (`fleet.ts:2173`: "A persisted verdict would be a cache git cannot reach").

**The budget entry is a reading, not a call.** `spent: 0`, `remaining` from `utilization`. An API-key account sends no `rate_limit_event` and writes no entry; the usage-limit path then reads the run's end as wave 2 does. Do not synthesize an entry for it.

**`utilization` and `resetsAt` are an open question, and this wave closes it.** `sdk.d.ts` types both as `number` and states no unit. Record ONE live `rate_limit_event` as the test fixture and fix the mapping from it; do not guess seconds versus milliseconds or a 0–1 versus 0–100 scale. `AgentRunLimitReading` carries both unconverted today, and the conversion happens in `rateLimitEntry` only. If this machine's account sends no event, say so in the PR and leave the question open rather than fixing a scale from the type.

**Carried over from related work, unchanged:**

- Absent is not false. `usageByModel` empty and `costUsd: null` mean "this connector reported none" (the `command` adapter), never zero spend: write no run line for a result that reports none, and have `readSpend` read an empty record as `absent`.
- `Slice max spend` and `Agent max spend` have no default, because a dollar figure depends on the account's plan and Plot cannot know it. A missing key means no limit, not a limit of 0.
- A record write failing is logged and does not fail the run: the work is done, and a lost line costs a reading, not the slice.
- A decision reads the index: the index never says no. A missing or unparseable spend record means "not measured", never "spent nothing", and never a refusal.
- Read the exit code and the structured result, not the emptiness of the output.

### Done when

The plan's `## Done When`, **Slice 3**, is the specification:

- An SDK run appends one run line, and each `rate_limit_event` appends one budget entry, both shown by a test against the file adapters.
- `readSpend` and `planSpend` pass the three `readSpend` cases in the plan's Tests (two run lines of one resumed session give the second run's increase once; a counter reset adds the new value; a record holding a seal line and run lines for one branch gives the right total), and a slice with one `checks` resume and two corrections reads its cost once.
- A session whose run lines read $10, $0 and $15 reads $15.
- A sealed SDK slice has run lines and no seal line, a sealed `command` slice has its seal line, and a slice that changed runner has one seal line for its `command` sessions only, each with a test.
- A run that ends `turn-limit` gets one fresh session from the registry tick and no second one; a slice whose cost reaches `Slice max spend` starts no next run and ends `spend-limit` with no fresh session (tests at 100% domain coverage).
- `freshAgentAfterCorrections`'s tests pass unchanged.

Assertions that exist because a naive implementation would pass without them:

- **A resumed session's two run lines read the second run's increase, not the second line's value.** Catches a reader that sums cumulative figures, which counts the first run twice.
- **$10, $0, $15 reads $15, not $5 or $25.** Catches a zeroed run line read as a counter reset or as a refund.
- **A `turn-limit` slice whose `fresh-agents.tsv` already holds a row answers `needs-a-person`; a slice with a `corrections-spent` fresh row and then a `turn-limit` also answers `needs-a-person`.** Catches two separate allowances, which let one slice start two fresh sessions.
- **A `spend-limit` ending answers no fresh session, whatever the record holds.** Catches a limit rule that restarts the slice against the same spend.
- **A `command`-adapter result (empty usage, `costUsd: null`) writes no run line.** Catches a zero-spend line that reads as a free run.
- **A `rejected` status writes `remaining: 0`, whatever `utilization` says.** Catches a `1 − utilization` that reads a rejected limit as headroom.
- **An older seal-only record and a new mixed record both decode through the same schema, and a run line read by a seal-only decoder counts as `unreadable`.** Catches a union that breaks the lines already on disk.
- **The key-set test on the per-model tokens fails for a fifth key.**
- **`Slice max spend` unset starts the run.** Catches a missing key read as 0.

Plus the repo's gates. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Comment lines in `plot-config.sh` count. If the slice touches a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Do not run `pnpm build:board` into a commit: a PR's diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`); build only to test, then restore the generated paths. On a conflict in `board-server.mjs` follow Definition of Done › Resolving a board artifact conflict.

A **changeset** is required: `.changeset/*.md` with the description FIRST (20 characters at least) and the `bumps:` block LAST, package `plot`, with a `plan:` line inside the same comment block. The plan's Changelog already carries the user-visible lines for this wave (the run records, the usage-limit readings, `turn-limit`'s fresh session, `Agent max spend` and `Slice max spend`). Name the `skills/plot` bumps there. Run `./scripts/check-changeset-packages.sh`. Do not edit `metadata.version` by hand.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

The PR body records the live `rate_limit_event` the fixture came from (or states that none arrived), and the figure `readSpend` gives for one real SDK slice against its transcript total, with the difference named: run lines include subagents and compaction.

### Scope guard

This branch owns:

- `packages/domain/src/entities/slice-spend.ts`, `ports/slice-spend.ts`, `rules/slice-spend-record.ts`, `rules/plan-spend.ts`, and the new rules (`rateLimitEntry`, `sliceSpendRefusal`, `freshAgentAfterTurnLimit`) with their tests
- `packages/domain/src/adapters/slice-spend/slice-spend-file.ts` and `adapters/fresh-agent-record/` (only what the new rule needs)
- `packages/board/src/server/entry/slice-spend.ts` (the seal skipping run-line sessions), `entry/registryd.ts` (the `turn-limit` step), and the part of `entry/worker-loop.ts` that appends the run line and the budget entry and checks `sliceSpendRefusal`
- `packages/board/src/server/board.ts` and `contract/schema.ts` only for the plan cost's changed definition and the note beside it
- `skills/plot/scripts/plot-config.sh` (the `Agent-runner keys` comment group, comment lines only)
- `.changeset/`

**Do not touch:** the ten board routes (`idea.ts`, `commission.ts`, `reslice.ts`, `deliver.ts`, `story.ts`, `brief-ask.ts`, `implement.ts`, `interrogate.ts`, `approve.ts`, `auto-deliver.ts`) and `board-server.mjs`'s SDK: wave 4's. The spawn ratchet's `allowed` in `ci.yml`: wave 4 sets it. `freshAgentAfterCorrections`: it does not change. The rules wave 1 wrote (`sdkRunExit`, `runLimitRefusal`, `runnerChoice`, `pollRefusal`, `agentRunEnv`) change only where a test of yours finds a defect; report that rather than rewriting the rule. `.plot/worker-prompt.sh` and `plot-worker-loop.sh` stay as they are.

**One branch is in flight and it overlaps you.** `infra/the-loop-restarts-on-new-code` (plan `the-worker-loop-runs-in-js`, verified with `git ls-remote --heads origin` and `git diff --stat origin/main...origin/infra/the-loop-restarts-on-new-code` at brief time) adds `rules/loop-restart.ts`, `ports/reexec.ts`, `adapters/reexec/` and 216 lines in `packages/board/src/server/entry/worker-loop.ts`. Your edit to `worker-loop.ts` is small and local to the run's end; keep it to the lines you need, and rebase onto `main` before you open the PR, since that branch may merge first. Do not reformat or move code in that file.

The plan's open questions: the scale of `utilization` and `resetsAt` is this wave's, closed by the recorded fixture. The per-run turn distribution is wave 5's: leave it open.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
