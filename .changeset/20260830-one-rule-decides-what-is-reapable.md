---
'plot': patch
---

One rule decides which worktrees may be reaped, and the reaper was looking at nothing.

**The reaper saw no worktrees at all.** Refusal 5 identified a dispatch tree by
its path, matching only the legacy `plot-wt-` layout that `plot-dispatch.sh`
uses when `Worktree root` is absent. A repo that configures one — this one —
has every tree at `.worktrees/<branch-with-dashes>`, matching nothing.
Measured 2026-08-30: nine dispatch trees present, `reapable=0 kept=0`.
**`kept=0` rather than `kept=9` is the tell** — a refusal counts and a skip does
not, so *nothing to clean* and *nothing was looked at* printed the same line.
It now asks the disk: `.plot-worker.pid`, which the dispatcher writes at
creation, is a marker Plot left rather than a name Plot hoped was used. The
legacy path is still accepted and is not in transition.

**The five refusals are now `packages/domain/src/rules/reapable.ts`**, returned
as named values carrying the reading each was taken from — the pid for
`live-worker`, the offending path for `uncommitted-changes` — rather than a
boolean the caller infers a reason from. In shell they were five `if`s nothing
could test; each is now triggerable against a fixture, including combinations a
real estate will not produce on demand: a marker and a live pid at once, a host
that cannot be asked at all.

`MergeReading` is a tri-state where the shell reading is a boolean. `pr_merged`
collapses *not merged* and *cannot ask* into one exit code, deliberately, since
both must keep the tree — the rule keeps them apart at the input so an unaskable
host is triggerable rather than only inferable. Both refuse: **silence is never
permission**, and `mergedAt` is read, never `state`, never ancestry.

`reapRefusals` on the `Worktree` entity delegates to the rule instead of
carrying a second copy. The two had already drifted on order, and the entity's
own docstring names that drift as what would delete somebody's work.

**`--dry-run` is byte-identical, before and after, on the same estate** — the
assertion that makes a rewrite of this script safe, since its refusals are the
only thing between a cleanup and losing work. Taken against the *fixed* script:
frozen against a reaper that looked at nothing, it would have proved only that
the rewrite is faithfully blind.

`plot-reap.sh` now needs `node`, where it deliberately did not before. The
constraint is retired rather than quietly broken — the alternative is a second
implementation of the five refusals in shell where nothing can test it, and a
copy drifting toward permissive fails in the direction that deletes work. **A
rule that cannot be asked refuses**: with `node` unavailable the run keeps every
tree and names each one.

<!--
bumps:
  skills:
    plot: patch
-->
