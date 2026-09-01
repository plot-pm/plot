---
'@plot-pm/board': patch
---

The four refusals that stop a worktree moving become a domain rule. `plot-dispatch.sh`'s migrate mode holds no `if` about whether a tree may move: it gathers what was measured — the desk's activity, a live pid, a dirty path, unlanded commits — and `plot-movable.mjs` returns the refusal. They were shell `if`s until now, and nothing could trigger one in isolation, least of all the combinations an estate will not produce on demand: a live pid and a dirty tree at once. Liveness and unlanded work stay two separate measurements, because `plot_worker_state` is keyed on the records a dispatch writes and a hand-made worktree that never ran one reads `none` however dirty its tree is — and hand-made worktrees are precisely the estate migrate mode exists to tidy.
