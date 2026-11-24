## Implementation brief — the-default-runner-has-a-spend-cap

- **Plan (canonical):** `docs/plans/2026-11-23-the-default-runner-has-a-spend-cap.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3698 merged
- **Branch:** `feature/the-default-runner-has-a-spend-cap` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one slice. Nothing waits on it and it waits on nothing. Line numbers below are read on `origin/main` at `03376c9ed`; run `git grep` for the name if a line has moved.

### What to build

A slice on the default `command` runner has no ceiling. `Agent max spend` and `Slice max spend` bound the SDK runner only, both are blank by default, and Plot's own `CLAUDE.md` sets no `Agent runner`, so every agent here runs on `command` with no bound but `Worker bound` (28800 s) and `Correction budget` (2). The record of what a slice spent exists (`.git/.plot/state/slice-spend.jsonl`, 82 lines on 2026-11-23) but a `command` slice writes its line only when it is sealed (`recordSliceSpend`, `packages/domain/src/workflows/slice-spend.ts`), so mid-slice the record reads nothing.

Add a `## Plot Config` key, `Slice max tokens`. Before each run the worker loop sums what the slice has spent in tokens. A slice at or above the cap starts no further run and ends `spend-limit`, the ending an SDK slice at `Slice max spend` already gets. With the key absent, nothing changes.

The mechanism, on top of what exists:

1. **A domain rule** `sliceTokenCap(spent, cap)` in `packages/domain/src/rules/`, answering `under`, `reached` or `unread`. A new file, an arrow function, TSDoc that states behaviour only. Export it the way `slice-spend-refusal.ts` is exported and add it to the domain's index if the others are.
2. **A reading.** `WorkerLoopPorts.sliceCostUsd` (`packages/fleet/src/server/entry/worker-loop.ts:224`, built at `:280`) answers dollars from `readSliceSpend`. Add a sibling port that answers tokens: the run lines' and newest seal's tokens that `readSpend` already derives (`SpendRead.tokens`), plus, for a `command` slice, the slice's own session transcripts that no seal covers yet (`SliceSpendRecord.sessions(worktree)`, the same call `recordSliceSpend` makes).
3. **A config key.** `readPass` builds the readings (`worker-loop.ts:932`, `:962-963`) and `main` reads the config (`:2819-2820`). Add `sliceMaxTokens` beside `sliceMaxSpendUsd`. Read it like `Slice max spend`: absent or blank is no limit, and a present value that is not a positive whole number refuses the worker's start, logged with the key and the raw value, as the loop at `:2707-2713` does for the dollar keys.
4. **A decision.** `spendLimitEnding` (`packages/domain/src/workflows/agent-loop.ts:427`) is asked at every place a run starts (`:502`, `:547`, `:725`, `:1011`, `:1044`). Extend it, or add a sibling asked at the same five places, so a reached cap ends `spend-limit` with a `blockedDeclaration`. Its summary names the token cap, not dollars.
5. **The docs line.** `skills/plot/scripts/plot-config.sh:163-168` documents the two spend keys. Add `Slice max tokens` there.

### The decisions the plan settles — do not re-derive them

**Tokens, not dollars.** A `command` run reports no price and its transcripts report tokens. `SpendRead.costUsd` is `null` for a slice with no run line, because a seal line records no cost (`slice-spend-record.ts`). A dollar cap cannot bound a `command` slice, so do not extend `Slice max spend` to do it and do not add a price table. `slice-tokens.ts` records that this estate excluded a price table on 2026-08-29.

**Cache reads do not count.** Input, output and cache-creation tokens count. Cache-read tokens are billed at a fraction and dominate every line of the record: 6,680,819 cache-read against 26,060 output on the first line, and 99.36% of a four-counter total on the largest of three transcripts measured on 2026-09-15 (`slice-tokens.ts`). The plan leaves a weight for cache reads as an open question (`question-cache-reads`). Do not implement a weight. Count cache reads as zero.

**Do not add a fifth summed field.** `slice-tokens.ts` forbids a pre-summed total on `TokenCounts`, because a four-field total is a cache-read count wearing a cost's name. The cap's sum of three counters is computed inside `sliceTokenCap`'s caller or the rule itself, from the four kept-apart counters. Do not change `TokenCounts`, `SPEND_USAGE_FIELDS` or `CONTEXT_USAGE_FIELDS`.

**`unread` starts the run.** A transcript that does not parse reads `unread`. The loop logs the reason and starts the run, because a reading failure must not stop the fleet. This is the opposite of an unreadable key, which refuses the start: a cap the operator wrote and the loop cannot read is a silent loss, and a transcript the loop cannot read is a fault in the record. Do not collapse the two.

**No default cap.** The plan leaves a shipped default as an open question (`question-default`). Ship none. With the key absent the loop behaves exactly as before.

**No board change.** `spend-limit` already has a board word. The plan leaves the board's tokens-against-cap display open (`question-board`). Build none.

**Rules carried over unchanged.** Absent is not false: an absent key never refuses and never reads as `0`. Read the exit code, not the emptiness: an unreadable record and an empty one are different answers (`recordSliceSpend` says so at its `transcripts-unreadable` refusal), and only an answered zero says the slice spent nothing. A function you write or rewrite is an arrow.

### Two hazards the plan does not name

**Sealed sessions must not count twice.** A seal line carries a total and no session ids. `recordSliceSpend` re-sums every session that has no run line each time it seals, so the newest seal already holds the earlier ones, and `readSpend` takes the newest seal only. A reading that adds the newest seal's tokens to a fresh sum of every non-run transcript counts the sealed sessions twice, and a slice reaches the cap at about half of it. Decide how the reading separates sealed from unsealed sessions, state the rule in the TSDoc, and test it with a slice that carries a seal line and a later unsealed session. If the record cannot separate them, report it as a plan question and do not guess.

**Read transcripts only where a cap is set and a run is about to start.** `readPass` reads `sliceCostUsd` on every pass, and a pass can poll while it waits. The largest worker transcript measured was 7.7 MiB (`slice-spend.ts`). Summing transcripts on every pass for every slice costs reads the key's absence must not pay. With `Slice max tokens` absent, open no transcript. A test names this.

### Done when

The plan's `## Done when` list is the specification: `sliceTokenCap` answers `under`, `reached` and `unread`; the loop starts no run at the cap and logs `unread`; an absent key changes nothing. Assertions that exist because a naive implementation passes without them:

- **At the cap is reached.** The cap is "at or above". A test pins `spent === cap` as `reached` and `cap - 1` as `under`. A strict `>` passes every other test.
- **Cache reads are ignored.** A slice with 10 input, 10 output, 10 cache-creation and 1,000,000 cache-read tokens against a cap of 31 is `reached`; against a cap of 32 it is `under`. This catches a four-field sum.
- **Absent runs, unreadable refuses.** `Slice max tokens` absent starts the loop. `x`, `0`, `-5` and `1.5` each return a non-zero code from `main`, naming the key and the raw value, before any take-up write and before any runner start. A parser that refuses everything non-numeric, absence included, passes the `x` test and stops every loop.
- **Both runners.** A cap reached on an SDK slice and on a `command` slice each end `spend-limit`. A fix wired to one runner passes a one-runner test.
- **The `command` slice is bounded while it runs.** A fixture with unsealed session transcripts and no seal line reads `reached`. This catches a reading that waits for the seal, which is the gap the plan exists to close.
- **No transcript opens with the key absent.** A test asserts the sessions port is not called.
- **No double count.** The seal-plus-unsealed fixture above.
- **The ending carries a declaration.** `spend-limit` ends with a `blockedDeclaration` naming the token cap, so the board's word and the continue route's refusal have something to show.

Plus the repo's gates. A changeset with the description first and the `bumps:` block last; the description is what the changelog publishes. `plot-config.sh` is a shipped script, so the changeset names `'plot': patch`. Run `scripts/check-changeset-packages.sh` locally; it names the package names it accepts. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; the `plot-config.sh` edit is comment text, so confirm the gate passes, and if it does not, remove an equal number of shell lines elsewhere in the same change. The gate stores no number and has no override. `skills/plot/scripts/board/plot-worker-loop.mjs` is generated: `pnpm build:board` rebuilds it for local tests only, and a committed rebuild fails `scripts/check-no-bundle-diff.sh`.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 26 (`nvm use`).

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names the three open questions and states that none of them is built.

### Scope guard

This branch owns the token cap:

- `packages/domain/src/rules/` — the new `sliceTokenCap` rule and its test in `packages/domain/test/`.
- `packages/domain/src/workflows/agent-loop.ts` — `AgentLoopReadings`, `spendLimitEnding` and its five call sites.
- `packages/fleet/src/server/entry/worker-loop.ts` — the new reading port, `readPass`, the config read in `main` and the start refusal.
- `packages/fleet/test/unit/worker-loop-run.test.ts`, `worker-loop-sdk.test.ts` and `packages/domain/test/workflows-agent-loop.test.ts` — the new cases.
- `skills/plot/scripts/plot-config.sh` — the key's documentation, comment text only.

Not this branch's: the continue route. `packages/fleet/src/shared/continuation.ts:959-970` refuses a continuation on `Slice max spend` and reads no token cap, and `ContinueWithAnAnswer.tsx:63` words `spend-limit` as a `Slice max spend` limit. A slice that ends `spend-limit` on the token cap and then takes a continuation is not stopped by it. Report this in the PR body as a follow-up and do not widen this branch. Also not this branch's: `TokenCounts` and the transcript summing in `slice-tokens.ts`, the board's display, and the `Slice max spend` dollar parser.

Other branches in flight, checked at dispatch on `origin`: `bug/a-new-failure-on-main-starts-a-repair`, `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`, `bug/the-board-reader-reads-main` and `feature/the-main-reading-becomes-a-pr-status`. The names do not suggest a collision with `worker-loop.ts` or `agent-loop.ts`, but that is read from the names and not from the diffs. `worker-loop.ts` is a large file that many plans touch; rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
