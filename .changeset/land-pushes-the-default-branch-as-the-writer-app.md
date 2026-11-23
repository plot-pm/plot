---
'plot': patch
---

`plot-state-cut.mjs --land` now lands a record on the default branch where no `State branch` key is declared: it fetches `origin/<default>`, merges it into HEAD, refuses on a conflict, and pushes through `plot-push-main.sh`, which takes the push lock and pushes as the `Writer app` on a GitHub origin where one is declared. With no key it refuses with exit 1 and pushes nothing where HEAD is not on the default branch. Exit 4 no longer means that no `State branch` key is declared; it now comes only from `plot-push-main.sh` when the Writer app refuses. `plot-sprint`'s PR-aware commit pushes its sprint branch with a plain `git push`, and `plot-sprint`, `plot-release`, `plot-reject` and `plot-idea` call `--land` on a default-branch checkout with no bare `git push` fallback.

<!--
bumps:
  skills:
    plot-sprint: patch
    plot-release: patch
    plot-reject: patch
    plot-idea: patch
-->
