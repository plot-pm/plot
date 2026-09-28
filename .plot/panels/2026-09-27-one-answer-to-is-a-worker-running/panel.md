# Delivery panel: one-answer-to-is-a-worker-running

Caller: `/plot-deliver`, unattended, 2026-09-28. Subject: `docs/plans/2026-09-27-one-answer-to-is-a-worker-running.md`. Evidence: PR #1033, merge commit `b17a3c47`.

Reconcile: `divided	refuted=deliverable,changelog	supported=behaviour`

All three jurors passed both gates (`Position`, `Evidence`), and each one committed `Evidence: executed`.

## The disagreement

Only Done-when item 3 is in dispute: *"A desk holding unpushed commits is never reaped, and the refusal names them."* All three jurors support the other six items after they ran the tests: `reap-agent-liveness.test.mjs` and `reap-merged-pr.test.mjs` pass 13 of 13, and the domain `reapable`/`worktree` tests pass 79 of 79.

The jurors agree on the fact and disagree about what it means:

- **The fact, which all three confirm.** The `NO MERGED HEAD THIS DESK CONTAINS` arm of `desk_unpushed` (`skills/plot/scripts/plot-reap.sh:255`) sets the unpushed list to empty when the desk holds none of the heads the host names as merged, or when the host answer carries no head. A desk in that arm is reaped even when it holds a commit that no remote has.
- **Deliverable and changelog (refuted)** each built a sandbox desk with a never-pushed commit on top of a merged branch, and `plot-reap.sh` reaped it: `would … PR merged (squash)` and `reaped feature/probe-elsewhere PR merged (squash)`. The plan says *never*, and the changeset says the refusal *"keeps any merged desk holding commits no remote has"*. Both claim more than the shipped guard does.
- **Behaviour (supported)** saw the same arm, but read it as intended: the test `a merged desk whose merged head this desk does not hold is reaped` asserts the behaviour on purpose. Behaviour classed it as a residual gap for squash merges, not as a failure of the item as the plan words it.

The question for the owner: does item 3 promise *never*, or *never when the merged head is on the desk*? The code comment states the second. The plan and the changeset state the first.

## What the jurors had in common

All three jurors read the same diff and ran the same two test files. The PR's own tests cover the squash arm only with a desk whose commits were all pushed. None of those tests catches a local commit made after the push. Two jurors caught it only because they wrote a probe outside the suite.

## Ways to close it

1. Amend Done-when item 3 and the changeset to state the scoped guarantee (merged head present on the desk). Then deliver.
2. Close the gap in code. In the no-merged-head arm, answer `unknown` (keep the desk) when `--not --remotes` lists commits newer than the PR's merge time. Add the late-local-commit fixture as a test. Then deliver.

## Also observed (read only)

`pr_merged_heads` in `plot-pr-merged.sh` calls `gh` directly. On a Bitbucket checkout it returns non-zero, so a merged desk with commits on no remote ref reads `unpushed commits: unknown` and the desk is kept. This errs toward keeping the desk. `scripts/check-host-cli-callers.sh` passes because `plot-pr-merged.sh` is exempt.
