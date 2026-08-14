---
"plot": minor
---

Fix everything a reality-check audit found — including one silent correctness bug.

An adversarial audit ran every documented claim in throwaway repos instead of reading the code. It found that the fleet's central promise did not hold.

**Claim-by-ref provided no mutual exclusion.** An empty claim branch points at `origin/main`, so a second dispatcher pushing the same branch pushed what was already there: "Everything up-to-date", exit 0. Both sides believed they owned it, and two real dispatchers each reported `dispatched=1` for the same branch. The `skipped (claimed by another session)` path was unreachable — dead code — and **no test exercised a contested claim**, which is how 135 green tests coexisted with the bug.

Claims now carry an empty commit, so two independent claims diverge and the loser is rejected as non-fast-forward. Claim detection follows: a claim is a branch whose only commits beyond main are claim markers. The old shape (no commits of its own) is no longer treated as a claim — it is indistinguishable from merged work, and treating it as one hid real deletion candidates.

**`--loose` was weaker than promised.** The plan promised "the prior wave's PRs are green and ready"; the code accepted any pushed commit, so red CI or a draft PR opened the next wave — building on a seam that was not merely unlanded but possibly broken. It now verifies PR readiness through the host adapter, and where readiness cannot be established it degrades to strict and says so. An unverifiable claim of readiness is not readiness.

**The merge queue was wave-blind**, ordering purely by footprint, so a small wave-2 branch could be recommended ahead of a larger tracer — inverting the premise that an earlier wave proves the seam. Wave order now dominates size.

**`declare -A` had crept in** with that fix, breaking the queue outright on stock macOS (bash 3.2). A new test now rejects bash-4-only constructs across every script — CI runs bash 5, so no fixture would have caught it.

Also: the stall-threshold key named in the fleet skill was one no script reads; `plot-fleet-scan.sh`'s header claimed in caps that it never writes a repo file, in the `--log-pulse` mode its own skill mandates every run; `dry_seen` was unbound dead code; `--max` silently accepted non-numbers; `--help` printed a truncated range; and branches sharing a last path segment (`feature/api`, `bug/api`) collided on one worktree, so `--stop` could stop the wrong worker.

Docs describing the claim mechanism (README, MANIFESTO, intro) are corrected to match.
