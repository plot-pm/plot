---
'plot': patch
---

fleetd's idle pass asks the tick's merge memo whether each worktree branch merged, so a branch the PR index settles as merged costs no `pr-merged` process. Before this change the idle pass asked the host once per worktree branch on every tick: on a checkout with 135 worktrees an idle fleetd started 139 to 188 processes per second. The tick also stops reading `git status` in the main checkout and in each worktree whose branch a plan names; only a tree nothing claims is asked, because only the unclaimed-tree finding reads the count.
