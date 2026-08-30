---
'plot': patch
---

A branch reset to the default branch reads `open`, not `merged`.

`branch_state`'s zero-ahead arm answered `merged` for two different shapes, and
only one of them is landed work. A branch **behind** the default branch has its
work on it and is merged. A branch pointing **at** it holds nothing. Ancestry
cannot tell them apart: a branch at the default branch's tip is trivially an
ancestor of it, so every ancestry test passes.

**Measured 2026-08-29.** `feature/one-deliver-rule-decides-in-the-domain` was
reset to `origin/main` so a worker could rebuild it; its PR (#511) had been
CLOSED, never merged. Seconds later the scan reported:

```
  Deliverable — complete
      feature/one-deliver-rule-decides-in-the-domain — merged
  Transitions — eligible
```

Neither line was true. The slice's work did not exist, and `Transitions` became
eligible on the strength of it. `merged` is the state that **settles** a wave,
so this error does not stall the fleet — it advances it onto a seam nobody
wrote, which is the worse direction.

**The discriminator is the other direction.** With zero commits ahead a branch
is either equal to the default branch or a strict ancestor of it, so *"behind =
0"* and *"tip = default tip"* are one predicate. Compared as OIDs because both
are **already in hand** from the ref batch — a `rev-list --count` would
re-derive it at one spawn per branch, the per-branch tail this scan has
repeatedly been thinned to remove.

**No host call is added.** The check is local. `a-throttled-host-says-so`
measured `plot-pr-merged.sh` answering *not merged* for three genuinely merged
branches while throttled, and this reading must not inherit that failure mode —
asserted by a stubbed host whose every PR query exits non-zero, under which the
reading is unchanged.

**The squash path is untouched, and both directions are pinned.** Its mirror
defect — a squash-merged branch reading `open` — is a separate plan, and a fix
for one can break the other:

| | ancestry says | truth |
|---|---|---|
| squash-merged | not an ancestor → *open* | merged |
| reset to default | is an ancestor → *merged* | holds nothing |

A squash-merged branch is *behind* the default branch and still reads `merged`;
one whose ref was pushed back after the merge counts `ahead > 0` and never
reaches this arm at all. Testing only the reset case would pass with a rule as
crude as *"zero commits ahead means open"* — correct there, and silent about
whether the squash path survived. Four tests cover both directions, two of
which failed before this change and two of which passed and must keep passing.

No new state enters the vocabulary: `open` is what the scan already says for
work not yet done, so the wave arithmetic is unchanged.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
