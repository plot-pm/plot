---
"plot": patch
---

plot-fleet: one walk per branch, not two

`branch_state` asked `git rev-list --count "origin/$MAIN..origin/$br"` for the
total commit count, then called `real_commits_beyond_main`, which walks **the
same range** with `git log` to classify each commit. Two spawns for one
question, once per branch — **64 `rev-list` calls** measured on this repo, the
last per-branch block left after #262 batched the plan reads.

The walk already visits every commit to classify it, so the total was a counter
it was computing and throwing away. It now returns `<total> <real>` and the
separate `rev-list` is gone.

**Both numbers from one reading also keeps them consistent by construction.** A
total and a real count taken from two walks can disagree if a ref moves between
them, and the caller compares the two to decide whether a branch is a bare claim.

`for-each-ref`'s `ahead-behind` would answer this repo-wide in a single call, and
needs git **2.41**. macOS ships **2.39**, so it is not available here.

**Measured on this repo:** 52 s → **20 s**, 203 spawns → 199, `rev-list` 64 → 58.
Verdicts identical across 20 plans and 58 branches, compared field by field
against `main`.

That puts the scan back under the original 30 s budget, so the 90 s raise in the
sibling change is now headroom rather than a requirement.
