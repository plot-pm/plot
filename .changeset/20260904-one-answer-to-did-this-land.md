---
'plot': minor
---

Every path that decides whether a branch's work landed reads the host, and a CI
gate refuses a new one that decides it from ancestry.

Measured 2026-09-04 on this estate: ten merged branches still carried a remote
ref, and `git merge-base --is-ancestor` disagreed with the host on **ten of
ten**. Squash-merge does not make ancestry occasionally wrong here — the
squashed commit is not the branch's commit, so a merged branch stays ahead of
main forever. `plot-pr-merged.sh` already stated the rule, and the two paths
that kept failing derived their own answer instead.

`plot-dispatch.sh` sources that helper: `held_worktree` asked ancestry whether a
worktree's branch had landed, so it called every squash-merged leftover a held
desk and refused a branch that was free. `plot-reconcile-scan.sh` gains
`branch_merged`, which reads the merged-PR list the scan already fetches in one
bundled call — no per-branch cost — and keeps ancestry as a second chance toward
"landed", for a branch pushed straight to main with no PR and for a host nobody
can reach. Its `merged_branches` set is renamed `ancestor_of_main`: a set named
for the question rather than for its evidence is how the two came to be treated
as one thing.

**The gate bans the decision, not the call**, and that is the harder half. Two
ancestry callers here are correct — `plot-merge-queue.sh` skips a branch already
in main before predicting a conflict, and `refs-git.ts` answers `unknown` when
it cannot tell. Neither asks *did this land*; they ask *can I skip this cheaply*,
where a wrong answer costs extra work rather than hiding finished work. A grep
for `--is-ancestor` would ban `refs-git.ts`'s own documented `unknown`, which is
the honesty this change asks for everywhere else.

No line-oriented match separates them, because the difference is what the answer
flows into. So each site declares its kind beside the call — `prefilter` when
the answer only ever skips work, `evidence` when something else decides — and
`scripts/check-ancestry-decisions.sh` refuses a site that declares nothing.
Verified against the tree before this change: it named `plot-dispatch.sh:2228`,
the defect, among seven undeclared sites. Six contract tests pin that it
refuses an undeclared call, accepts both declared kinds, ignores prose about
ancestry, and requires the declaration within five lines of the call.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot: minor
-->
