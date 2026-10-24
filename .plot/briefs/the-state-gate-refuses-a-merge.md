## Implementation brief — the-state-gate-refuses-a-merge

- **Plan (canonical):** docs/plans/2026-10-24-the-state-gate-refuses-a-merge.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2581 merged
- **Branch:** `bug/the-state-gate-refuses-a-merge` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (one full review per PR)

Single wave. No other branch waits on it or blocks it.

### What to build

`git merge origin/main` into a slice branch stages every `State:` change that landed on main since the branch point. Each change already passed the gate on main, but its receipt was spent on the machine that ran the controller, so the merge commit has none. Measured 2026-10-24 (issue #2580): the desk for PR #2576 merged `origin/main`, the merge staged two `Approved -> Delivered` transitions (`controller-gate-fires-on-a-script`, `deliver-flips-the-status-block-but`), and `git commit --no-edit` was refused. The staged text of both files was byte-identical to `origin/main`.

The fix has two halves, both in existing code:

- **Domain rule:** `stateTransitionsOf` / `stateTransitionOf` in `packages/domain/src/rules/state-transition.ts` take the other parents' texts per path as an extra reading and drop a transition whose committed text equals one of them. Readings stay values: the rule stays synchronous and awaits nothing. Write new functions as arrows.
- **Adapter reading:** the `state` gate in `packages/board/src/server/entry/gate.ts` (`stateGate`, about line 205) reads `MERGE_HEAD` and `git show <parent>:<path>` per other parent and adds them to each `LifecycleReading`. `skills/plot/scripts/board/plot-gate.mjs` is generated output: do not commit it.

### Settled decisions — do not re-derive

- **Compare whole-file text, not the `State:` line.** A merge that also hand-edits the `State:` line, or any line that changes the extracted value, equals neither parent and keeps requiring a receipt. Comparing the extracted value would let a hand edit ride in on a legitimate merge.
- **An unreadable parent counts as no match.** The gate refuses as today. Absent is not equal.
- **Non-merge commits are unchanged.** No `MERGE_HEAD` means no extra readings.
- **Other parents only.** Equality with `HEAD`'s own text is not a transition anyway.
- **Additions and renames:** the plan proposes the same equality test for an addition. Check #1611's cases (removal, addition, rename) in `test/reconcile/state-gate.test.mjs` before treating that as settled. A removal can never be cleared.
- **The plan's open questions** (octopus: equality with any one non-`HEAD` parent; conflict-resolved text matching neither parent keeps the receipt requirement; the `Spike approved:` receipt key under the same test): implement the proposed answers, name each in the PR, and report if one cannot hold. Do not widen them.
- **Do not weaken the receipt path.** The gate says who may write. This slice adds one proof of provenance (the other parent already passed the gate), not an exemption.

### Done when

The plan's slice tests are the specification: a merge staging a receipted delivery from the default branch passes; a merge that edits the `State:` line by hand is refused; a non-merge commit is unchanged; an unreadable parent refuses.

Assertions a naive implementation passes without:

- A merge whose staged text differs from the other parent by one non-`State:` line, with the `State:` value also changed, is still refused. It catches comparing only the `State:` value.
- An octopus merge equal only to the second non-`HEAD` parent passes. It catches checking only the first parent.
- A merge equal to `HEAD` only is no transition and spends no receipt.

Add domain unit tests in `packages/domain` and the choreography cases in `test/reconcile/state-gate.test.mjs`. Mutation-test the gate: revert the new check and confirm the tests fail.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; do not run `test:e2e`. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice touches no `.sh` file. Add a changeset (`.changeset/<slug>.md`, package `plot`, description first, `bumps:` block last). The PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to the branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/domain/src/rules/state-transition.ts` and its tests, `packages/board/src/server/entry/gate.ts`, `test/reconcile/state-gate.test.mjs`, one changeset. No other branch of this plan exists. If you find something the plan did not anticipate, report it rather than improvising outside scope.
