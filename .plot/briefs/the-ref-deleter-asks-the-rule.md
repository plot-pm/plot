## Implementation brief — the-ref-deleter-asks-the-rule (slice: Asking it from the ref-deleter)

- **Plan (canonical):** `docs/plans/2026-09-05-a-desk-is-finished-with-once.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/the-ref-deleter-asks-the-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **The plan carries two interrogation rounds.** Read its Notes and Open Questions first — round 2 settled the shape of the answer this slice consumes.

Slice 2 of two. **`finishedWith` landed with #754** — verified in `rules/reapable.ts`.

## What this delivers

`plot-release-refs.sh` reads the rule's verdict and acts, the way `plot-reap.sh:46` already describes itself.

**THE REAPER IS THE WORKED EXAMPLE.** It reads `rules/reapable.ts` through an inline `node` block and says so in its header. Copy that shape; do not invent a second way for a shell script to reach the domain.

## This is the irreversible side

**A removed checkout comes back with `git worktree add`. A deleted ref does not.** That asymmetry is why the ref-deleter is scoped to one plan where the reaper is slug-blind — `plot-release-refs.sh:33`, *"the blast radius is bounded by the plan file."* **That scoping does not change here.**

## The assertion is one-directional, deliberately

**Asserted: every ref the script kept before is kept after**, run over this estate's merged branches.

**IT IS TRIVIALLY SATISFIED BY A RULE THAT REFUSES EVERYTHING — AND THAT IS THE ACCEPTABLE FAILURE.** Round 2 settled it: keeping too many refs costs scan time; deleting too many destroys work. The asymmetric assertion matches the asymmetric cost. **A rule that deletes one more ref than the guards did is wrong in the direction that cannot be undone.**

## `unknown` means *no evidence against deletion* here

This is the round-2 finding and it is the whole reason one rule can serve two scripts.

**Four of the reaper's five conditions need a worktree, and 69% of branches have none** (22 of 32, measured 2026-09-06). So `finishedWith` answers `true`, `false` or `unknown` per condition, and **the caller decides what `unknown` means**:

- the reaper reads it as *nothing to reap*
- **the ref-deleter reads it as *no evidence against deletion*** — which is exactly what it does today

**Do not refuse on `unknown`.** That would block deletion on the majority of the estate and make this script useless where it matters most.

## The five guards it keeps

`deferred:`/`moved:`, no merged PR, an **open** PR, checked out in any worktree, the default branch. **The script gains none of the reaper's guards** — no live-pid check, no `PLOT-BLOCKED`. `plot-release-refs.sh:30` warns that folding them *"would silently widen a licence that was written narrow on purpose."*

**What changes is where the conditions are stated, not which ones this script asks.**

## Done when

- `plot-release-refs.sh` reads `finishedWith` and acts on its verdict
- every ref the script kept before is kept after, over this estate's merged branches
- `unknown` permits rather than refuses, and the code says why
- the five guards are unchanged, and none of the reaper's is added
- the plan-scoping is unchanged
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not delete a ref the guards would have kept.** The one-directional assertion exists because this failure cannot be undone.
- **Do not refuse on `unknown`.** 69% of branches have no tree.
- **Do not add the reaper's guards**, and do not remove any of the five.
- **Do not widen the scope beyond one plan.**
- **Do not invent a second bridge to the domain.** `plot-reap.sh` already has one.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
