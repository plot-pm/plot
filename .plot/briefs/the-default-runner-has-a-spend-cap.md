## Implementation brief — the-default-runner-has-a-spend-cap

- **Plan (canonical):** docs/plans/2026-11-23-the-default-runner-has-a-spend-cap.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3698 merged
- **Branch:** `feature/the-default-runner-has-a-spend-cap` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required on `main` since 2026-10-15; one full review per PR

One slice, one wave (`### Cap`). Nothing waits on it and it waits on nothing.

### What to build

A slice on the default `command` runner has no ceiling today. `Slice max spend` and `Agent max spend` (`skills/plot/scripts/plot-config.sh:163-168`) bound only the SDK runner, `Agent runner` is absent in Plot's own `CLAUDE.md`, and the only bounds on a `command` agent are `Worker bound` (28800 s) and `Correction budget` (2). Add one `## Plot Config` key, `Slice max tokens`, and make the worker loop end a slice `spend-limit` instead of starting another run once the slice's tokens reach it.

The seams already exist; this slice reuses all of them.

- **The ending.** `spendLimitEnding` (`packages/domain/src/workflows/agent-loop.ts:414`) already produces the `spend-limit` ending and is called at five run-starting sites (lines 502, 547, 725, 1011, 1044). Extend it to ask the token rule as well, so every site that already refuses on dollars refuses on tokens. Do not add a sixth call site and do not invent a new ending word: `spend-limit` already has a board word (`rules/board-run-end.ts:98`) and an ending action (`rules/ending-action.ts`).
- **The rule.** New `sliceTokenCap(spent, cap)` in `packages/domain/src/rules/`, answering `under`, `reached` or `unread`, beside `slice-spend-refusal.ts`. An arrow function, TSDoc that states what it returns and how it fails, no decision history in the comment.
- **The reading.** `AgentLoopReadings` (`agent-loop.ts:141-156`) carries `sliceCostUsd` and `sliceMaxSpendUsd`; add the slice's counted tokens and `sliceMaxTokens` the same way, resolved in `worker-loop.ts` beside `sliceCostUsd` (`:280`) and `sliceMaxSpendUsd` (`:2820`). `readSliceSpend` already returns `SpendRead.tokens` (SDK run lines plus the newest seal), so the SDK half needs no new read.
- **The key.** Follow `Slice max spend` exactly: absent or blank is no limit; a present value that is not a positive whole number refuses the worker's start. The refusal loop is at `worker-loop.ts:2707`, which today iterates the two dollar keys through `dollarsOrUnset`. Add a whole-number reading next to `dollarsOrUnset` (`:2237`) rather than bending the dollar parser, and document the key in the `plot-config.sh` header block next to `Slice max spend`. Add `Slice max tokens` to `LOOP_CONFIG_KEYS` (`:2563`) if the shell reader needs it.

### The decisions the plan settles — do not re-derive them

**The `command` half needs a new reading, and this is the one hard part.** A `command` slice writes its seal line only when the slice ends (`recordSliceSpend`, `workflows/slice-spend.ts:87`), so `SpendRead.tokens` is empty for it while it runs and a cap read from the record alone would never fire. The plan's answer: before each run, also sum the slice's own session transcripts that the record does not yet hold. `recordSliceSpend` already does the sum: `record.sessions(worktree)`, skip sessions that hold a run line, `tokensForBranch(...)`. Factor that into a read that returns the unsealed tokens without appending, and add it to the sealed total. Do not copy the transcript-walking code. Do not write a seal line to make the number readable: a seal is once per slice, and a mid-slice seal would double-count against the real seal.

**Count input, output and cache-creation tokens. Cache-read tokens do not count.** Cache reads are billed at a fraction and dominate every line of the record (6,680,819 cache-read against 26,060 output on the first line of `.git/.plot/state/slice-spend.jsonl`, 82 lines on 2026-11-23). `rules/slice-tokens.ts` measured them at 98.6%, 99.3% and 99.36% of a naive four-counter total. Counting them would make the cap fire on how much context a slice re-read, not on what it generated.

**No stored total.** `rules/slice-tokens.ts` and `entities/slice-spend.ts` forbid a fifth, summed field in the record, and a test asserts the key set. `sliceTokenCap` sums the three counters at read time and nothing persists the sum. Do not add a field, and do not touch `TokenCountsSchema`. That doc also rules out a price-weighted sum for want of a price table; the plan's unweighted three-counter sum is a cap and not a cost, and the plan says so. Do not reopen it.

**Tokens, not dollars.** A `command` run reports no price; its transcripts report tokens. One key in tokens bounds both runners with one number. `Slice max spend` stays for the SDK runner's dollars, and both may be set: either one reached ends the slice.

**`unread` starts the run.** A transcript that does not parse must not stop the fleet. `sliceTokenCap` answers `unread`, the loop starts the run, and the loop's log names the reason. This is the same rule `sliceSpendRefusal` states for an unmeasured slice: absent is not false, and a record that cannot be read is a reason to run and find out. The reading that matters is "no measurement", never "zero spent".

**Open questions stay at the plan's current text.** The plan lists three: weighting cache reads, shipping a default cap, and a board display. Build what the plan's Design says: cache reads count at zero weight, **no default** (an absent key changes nothing for every adopter), and the board shows only the existing ending reason. If you find a reason one of these cannot hold, report it; do not resolve it by choice.

**The bound path records nothing, and that is a stated gap.** `slice-spend.ts` documents that a worker killed by `Worker bound` never seals, so the record is biased low. The unsealed-session sum closes this for the cap and does not change what the seal records. Do not write on the bound path.

### Done when

The plan's tests line is the specification: `sliceTokenCap` — under, reached and unread; the loop starts no run at the cap and logs unread; an absent key changes nothing. Lift these assertions, each of which a naive implementation passes without:

- **A `command` slice with no seal line and transcripts over the cap ends `spend-limit`.** A test that seeds only a seal line passes a build that never reads transcripts. This one catches the whole `command` half.
- **A cache-read-heavy slice under the cap on the three counted kinds does not end.** Seed cache-read tokens far above the cap and the other three below it. A build that sums all four fails here.
- **A session that already has a run line is not summed twice.** Seed one SDK session with a run line and its transcript. A build that sums transcripts blindly double-counts and ends the slice early.
- **An absent key leaves every existing worker-loop test unchanged**, and the run reads no transcript for the cap when the key is absent.
- **A present key of `0`, `-5`, `1.5` or `lots` refuses the start**, naming the key, as `Slice max spend` does. An absent or blank key does not.
- **The record's key set is unchanged.** The existing `slice-spend` tests must pass without edits.
- **Each of the five run-starting sites refuses at the cap**, not only the first. The sites are 502, 547, 725, 1011 and 1044; a build that wires one passes a one-site test.

Plus: a changeset for `plot` with the description first and the `bumps:` block last (naming `plot-config` consumers only if a skill's text changes; the `plot` package patch or minor is the author's call, and the key is new behaviour, so `minor`). Run `./scripts/check-changeset-packages.sh`. Body prose in `plot-config.sh` and any doc is in English. If the slice changes `skills/plot/scripts/plot-config.sh`, note that open PR #3634 (`docs/config-comments-match-the-code`) edits the same file's comments: rebase on it rather than resolving by hand.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. A bundle change (`skills/plot/scripts/board/plot-worker-loop.mjs`) is generated: do not commit a rebuilt bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The only shell this slice may touch is the comment block in `plot-config.sh`; comments are not commands, but if you add any command there, remove an equal number elsewhere. The rule belongs in the domain and the loop asks it through the bundle; write no shell for it.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work is moving), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new `sliceTokenCap` and its test), `packages/domain/src/workflows/agent-loop.ts` and `slice-spend.ts` (reading and ending), `packages/fleet/src/server/entry/worker-loop.ts` (key parsing, the reading, the start refusal), the key's comment block in `skills/plot/scripts/plot-config.sh`, and the matching tests under `packages/domain/test/` and `packages/fleet/test/unit/`.

In flight at dispatch: PR #3634 (`docs/config-comments-match-the-code`) touches `skills/plot/scripts/plot-config.sh`, comments only. No other open PR touches `worker-loop.ts`, `agent-loop.ts`, `slice-spend.ts` or `slice-tokens.ts`.

Out of scope: the board display of tokens against a cap, a default cap, a cache-read weight, a price table, any write on the `Worker bound` path, and a new ending word. If you find something the plan did not anticipate, report it rather than improvising outside scope.
