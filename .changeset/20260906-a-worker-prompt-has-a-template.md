---
"plot": minor
---

Plot ships a worker prompt template, and `/plot-init` writes it at adoption. `.plot/worker-prompt.sh` is what `plot-worker-loop.sh` sources on every prompt of every agent, and until now the repository held no template, no generator and no example for it — every adopting project wrote it from a comment inside the loop. `plot-install-prompt.sh` writes the template where no file exists and never overwrites one: an existing prompt is classified by what it passes, and `stale` (a hardcoded session flag) or `present` (no session arguments) is reported so the operator can decide, because a project's prompt wording is the project's. The template interpolates `PLOT_SESSION_FLAG` and carries no session decision of its own, so a project that rewrites every word of it still cannot hardcode `--session-id` back in. A `Worker prompt template` config key overrides the shipped one, the same shape `Plan template` already has.

<!--
bumps:
  skills:
    plot: minor
    plot-init: minor
-->
