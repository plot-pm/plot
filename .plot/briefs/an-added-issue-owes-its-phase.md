## Implementation brief — an-issue-shows-its-plan-s (wave: Added issues)

- **Plan (canonical):** [docs/plans/2026-11-01-an-issue-shows-its-plan-s.md](../../docs/plans/2026-11-01-an-issue-shows-its-plan-s.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Branch:** `bug/an-added-issue-owes-its-phase` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `pr`, per the plan's `Review:` answer

This branch waits on `bug/the-plan-comment-has-one-writer` (#3007, merged 2026-11-01) — the plan's Notes say why: `--only-issue` writes through `githubPlanStateWrite`, which posts the plan comment, and until #3007 landed that write carried four open defects (a lock release on a non-owning writer, a read-back failure treated as "no comment", a second comment per account, and a late progress write undoing a delivery). #3007 is merged, so this branch is unblocked. No other slice of this plan waits on this one.

### What to build

Fix the gap commit `0e8c71e28` exposed: a Released plan's `Issue:` line gained `#2697` after the plan had already released, and nothing wrote `plan:released` to that issue — the write only ever ran at the moment of approval/delivery/release, never when an issue joins the line afterward. The fix is two pieces:

1. **`issueTransitionOf`** in `packages/domain/src/rules/state-transition.ts` — a new domain function (the file does not have it yet; verified by `grep -n "issueTransitionOf" packages/` returning nothing). For a commit that changes a plan file, it answers every issue key the plan's `Issue:` line *gains* against `HEAD`, but only while the plan's `State:` **after** the commit is Approved, Delivered or Released. A key that leaves the line, or a line gained on a Draft/Design plan, needs no receipt and is not in the answer.
2. **The gate call plus `--only-issue`** — `packages/board/src/server/entry/gate.ts` calls `issueTransitionOf` alongside the existing `stateTransitionsOf`/`spikeTransitionOf` pair (`:434` today) and refuses an uncleared gained-issue key the same way `stateTransitionRefusal` refuses an uncleared `State:`/`Spike approved:` change, naming the command `plot-plan-state.sh --only-issue <key>`. `packages/board/src/server/entry/plan-state.ts` gains the `--only-issue <key>` flag: it writes the plan's phase to that **one** issue (which the plan must already name), and on a `written` outcome leaves the receipt that clears the gate. At `released` it runs `releaseIssueDecisions` (`packages/domain/src/rules/issue-status.ts:130`) for that one issue, the same close-on-release arm `deliver.ts`'s release path already runs for every issue.

### The decisions the plan settles — do not re-derive them

**The receipt key is `<plan path>#Issue <key>`, not the bare path.** This is `spikeReceiptKey`'s shape (`state-transition.ts:70`, `${path}#${SPIKE_APPROVED_FIELD}`) generalised to a per-issue suffix rather than a fixed field name — `receiptOf` (`:182`) already branches on `transition.field`, so this slice's transitions carry a field/key that routes to the `#Issue <key>` form instead of either existing branch. Two different gained issues on the same commit need two different receipts, which a bare-path key could not express — that is why this is not simply reusing `spikeReceiptKey` outright.

**The transition is keyed on the `Issue:` line's *added* numbers, not its whole value.** `stateTransitionOf` and `spikeTransitionOf` both compare a single scalar field's before/after string. `Issue:` is a list (`#2757` → `#2757, #2697`), so `issueTransitionOf` must diff the parsed issue sets, not treat the line as one opaque value the way the other two transitions do — reuse their file/kind/parent-text plumbing, not their before/after comparison.

**No receipt is owed when the *resulting* phase is Draft or Design, regardless of what the line looked like before the commit.** The plan states this as "No receipt is owed on a Draft plan or a removed key" (Done-when row, test file `packages/domain/test/state-transition.test.ts`). A plan can gain an issue while still in Design — that costs nothing, because no write is owed until Approved. Judge the *after* state, the same point `stateTransitionOf` reads `after` from.

**This slice does not touch `tracker-plan-state.ts`, `auto-progress.ts`, or `plot-host.sh`'s marker-comment matching — those are #3007's slice and are already merged and stable.** Build on `planStateWrites`/`writePlanStates` (`plan-state.ts:143`) as they stand; the `--only-issue` flag is new plumbing in this same file's `flagsFrom`/`run`, following the existing `--skip-issue` pattern (repeatable there; `--only-issue` takes exactly one value and restricts the write to that single issue rather than excluding issues).

**The gate's existing receipt-spend and picked-commit-replay logic is reused unchanged.** `gate.ts`'s loop at `:434-444` already handles `receipts.spend(key, value)` and the rebase/cherry-pick replay check (`pickedValueAt`/`pickedClears`) generically over any `StateTransition`-shaped object with a `key`/`value` pair from `receiptOf`. Making `issueTransitionOf`'s output fit that same `StateTransition` interface (or a value `receiptOf` can also read) is what lets this reuse happen with no new control flow in `gate.ts` beyond adding the new transitions to the list the loop already iterates.

### Done when

The plan's own Done-when table names four rows for this slice (`packages/domain/test/state-transition.test.ts`, `packages/board/test/unit/plan-state.test.ts`, `test/reconcile/state-gate.test.mjs`):

- **An added issue owes its phase** — commit `0e8c71e28`'s exact shape (Released plan, `Issue: #2757` → `#2757, #2697`): one transition for `2697` keyed `<plan>#Issue 2697`. Old code (no `issueTransitionOf`): none. This is the regression test for the actual incident.
- **No receipt is owed on a Draft plan or a removed key** — an issue gained on a Draft plan, and an issue dropped from a Released plan's line, both answer no transition.
- **`--only-issue` writes one issue and leaves a receipt** — a Released plan naming `#A` and `#B`, `--only-issue B`: exactly one `planStateWrite` for `B` at `released`, and the receipt `<plan>#Issue B` is left so the gate clears.
- **The gate refuses without the receipt** — committing the added key with no receipt exits 2, and the message names the `plot-plan-state.sh --only-issue` command (the pattern `stateTransitionRefusal`'s existing lines already set for `State:`/`Spike approved:`).

Plus the repo's standing gates: no committed `board-server.mjs` diff (generated artifact), a changeset naming `plot` or `@plot-pm/board`, and the domain/board typechecks. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps `packages/domain/**` and `packages/board/**` changes to their suites and runs the gate tests (including `test/reconcile/*gate*.test.mjs`, which covers `state-gate.test.mjs`). The suites in `CI suites` run in CI; a failure there comes back as a correction. Do not run a full suite locally.

This slice touches no `.sh` file directly (the new flag lives in `plan-state.ts`, a `.mjs`-built TypeScript entry; `plot-plan-state.sh` itself is already a launcher), so `scripts/check-shell-lines.sh` should need no offsetting line removal — confirm this holds once the diff is final, since the README row for `plot-plan-state.sh` may need a one-line update to mention `--only-issue`.

### Bookkeeping

Open the PR through `../plot/scripts/plot-open-pr.sh` (never `gh pr create`) once the branch exists. Push the first real commit as soon as it exists. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Added issues` heading.

### Scope guard

This branch owns: `packages/domain/src/rules/state-transition.ts` (`issueTransitionOf`, and a receipt-key helper beside `spikeReceiptKey`), `packages/board/src/server/entry/gate.ts` (the new transition call, folded into the existing refusal path), `packages/board/src/server/entry/plan-state.ts` (`--only-issue` in `flagsFrom`/`run`, the receipt write, and `releaseIssueDecisions` at `released`), and `skills/plot/scripts/README.md`'s row for `plot-plan-state.sh`.

Other branches in this plan, verified at dispatch:
- `bug/an-issue-reads-its-plan-from-main` (#3003) and `bug/the-plan-comment-has-one-writer` (#3007) are merged; this branch depends on #3007 only (per the plan's Notes) and both are already on `main`.
- `infra/released-issues-carry-their-label` (#3012) is merged — a different plan surface (the one-off backfill script), no file overlap with this slice.
- `bug/settled-finding-tickets-close` also waits on #3007 and may run concurrently with this branch; it touches `packages/domain/src/rules/review-issue.ts` and a new `finding-tickets.ts` entry — no overlap with this slice's files.
- `bug/a-slice-row-reads-its-head-s-checks` touches `packages/domain/src/rules/pr-row.ts` and `fleet.ts`'s PR-row call sites — no overlap with this slice's files, but the plan's Notes warn `fleet.ts` churned 24 times in a week, so rebase on `origin/main` before review if that branch's PR lands first and either touches `fleet.ts` incidentally.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
