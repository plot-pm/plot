---
'plot': minor
---

`pr_merged` and `pr_open` keep their names and exit contracts; the decision behind them moves into the domain as `rules/landed.ts`, reached through the `plot-landed.mjs` bundle. The shell functions are now the adapter — they ask the host and turn each lookup into `found`, `none` or `unaskable`, and the rule answers. All four sourcing callers are unchanged.

The coupling the pair depends on is now asserted rather than commented: an unaskable host makes the merge gate refuse and the open-PR veto release, so neither function is safe alone. `mayRemove` states the pair and permits a removal in exactly one of the nine reading combinations — including refusing a found merge whose veto lookup could not be asked, the case two independent calls cannot see between them.

`plot-pr-merged.sh` is also now vendored into the published package. Three of its four callers were already vendored and all source it as a sibling, so the npm layout has shipped without it — every gate then read the undefined function as *not merged* and kept every worktree, silently.

<!--
bumps:
  skills:
    plot: minor
-->
