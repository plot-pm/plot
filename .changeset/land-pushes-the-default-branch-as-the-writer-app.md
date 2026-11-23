---
'plot': patch
---

`plot-state-cut.mjs --land` now lands a record on the default branch where no `State branch` key is declared: it fetches `origin/<default>`, merges it into HEAD, refuses on a conflict, and pushes through `plot-push-main.sh`, which takes the push lock and pushes as the `Writer app` on a GitHub origin where one is declared. Exit 4 no longer occurs, and `plot-sprint`, `plot-release`, `plot-reject` and `plot-idea` call `--land` with no bare `git push` fallback.

<!--
bumps:
  skills:
    plot-sprint: patch
    plot-release: patch
    plot-reject: patch
    plot-idea: patch
-->
