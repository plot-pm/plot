# Panel — a claim is released, not deleted

**One lens, amend, executed.**

## The statelessness claim is verified

Two `plot-fleetctl.sh --once` runs, 293 lines each, byte-identical but for the cost field. The daemon holds nothing between ticks, exactly as the plan says.

## The premise built on it is false

The plan: *"Pass A assigns the branch to agent 1. The assignment's only durable record is the claim ref."*

It is not. The **agent manifest** carries the assignment, and `clear_manifest_branch` (`plot-worker-loop.sh:350`) is a separate writer for it. So the plan's central sentence — *"There is no way to clear one without the other"* — is wrong: deleting the ref clears the **scan's reading of branch state**, while the registry's record of the assignment lives in the manifest and is cleared elsewhere.

Two different facts, conflated, and the whole design rests on their supposed inseparability.

## So `--release` moves the problem

A verb that deletes the ref and calls it releasing the assignment would leave the manifest's `branch` field set. The juror reproduced the shape rather than reasoning about it.

## What survives

The measured incident is real and unexplained by this plan: the claim push for `feature/the-board-filters-to-my-work` was rejected, two agents held one branch, and a desk was abandoned with unpushed commits. That happened. **The account of why is refuted**, so the repair is not yet designed.

## Recommendation

**Amend at the mechanism.** Re-derive what actually goes stale when an operator deletes a claim ref, with the manifest in the picture, then decide what a release verb must clear. The current design would ship a verb that half-releases.
