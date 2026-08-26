---
"plot": minor
---

The dispatched-worktree root is a `## Plot Config` key.

`plot-dispatch.sh` put every worktree in the repo's parent, with a `plot-wt-`
prefix that existed only to make Plot's worktrees identifiable among the
unrelated directories they shared a parent with. `## Plot Config` now gains an
optional `Worktree root:` key: a relative value resolves against the repo root,
an absolute value is taken as given, and under a dedicated root the prefix is
dropped — the directory already says what these worktrees are. Declaring
nothing keeps today's behaviour exactly (beside the repo, prefix intact), so no
existing checkout moves.

The prefix is now a property of the root rather than a constant, resolved once
and carried alongside it. Every "which worktree holds this branch" read still
asks `git worktree list`; only the creation path composes a name. Converts
`plot-resolve-artifact.sh`'s worktree lookup from a composed path to a git
query — the one remaining site with the path-guessing shape the `held_worktree`
comment warns about.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot: patch
-->
