# Implementation brief — a-reset-branch-is-not-a-merged-one (Reading)

- **Plan (canonical):** `docs/plans/2026-08-29-a-reset-branch-is-not-a-merged-one.md` on main
- **Branch:** `bug/an-empty-branch-reads-open` (base: `main`)
- **Ends as:** one PR to main
- **The plan's only slice.**

### What to build

A branch that points at the default branch reads `open`, not `merged`. Zero
commits ahead means it carries no work — and *no work* is not *landed*.

### What it looked like when it bit

`feature/one-deliver-rule-decides-in-the-domain` was reset to `origin/main` so a
worker could rebuild it. Its PR (#511) had been **closed, never merged**.
Seconds later the scan reported:

```
  Deliverable — complete
      feature/one-deliver-rule-decides-in-the-domain — merged
  Transitions — eligible
      feature/a-transition-is-one-value — open
```

**Neither line is true.** The slice's work does not exist, and `Transitions`
became eligible on the strength of it.

### The decisions the plan settles — do not re-derive them

**Why ancestry says `merged`:** a branch pointing *at* the default branch is
trivially an ancestor of it, so every ancestry test passes. That reading is
right for the case it was built for — a squash merge leaves the branch behind,
and `merged_by_subject` recovers the evidence from main's history — and wrong
here, where the same shape means the branch holds **nothing**.

**This plan is the careful one of three, and knows it.** Its mirror,
`a-squash-merged-branch-is-not-quiet`, fixes the opposite error:

| | ancestry says | truth |
|---|---|---|
| squash-merged | not an ancestor → *open* | merged |
| reset to main | is an ancestor → *merged* | holds nothing |

**A fix for one can break the other.** Keep `merged_by_subject` working: a
squash-merged branch is *behind* main but has commits main does not contain by
subject, so it still finds them. A branch at main has neither.

**No host call is added.** The check is `rev-list`, offline. That is deliberate:
`a-throttled-host-says-so` measured `plot-pr-merged.sh` answering *not merged*
for three genuinely merged branches while throttled, and this slice must not
inherit that failure mode.

### Done when

- a branch reset to the default branch reads **`open`**
- a **squash-merged** branch still reads `merged` — the regression that matters,
  because it is what this change could plausibly break
- a branch with commits ahead is unaffected
- **no new host call**, asserted by a stubbed host that fails: the reading must
  be unchanged

**The trap:** testing only the reset case. It passes with a rule as crude as
*"zero commits ahead means open"*, which is correct here and says nothing about
whether the squash path survived. Both directions, or neither is proven.

Plus: `pnpm test`, `pnpm run test:reconcile`, changeset with a `bumps: skills:`
block.

### Scope guard

The reading. Not the squash case (its own plan), not the throttled host (its
own plan), not the board.

If you find the three plans want one shared rule, **say so in the PR** — that is
a finding worth having, and it is not this slice's to build.
