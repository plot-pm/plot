---
'plot': patch
---

`plot-config.sh` takes the repository root from `PLOT_REPO_ROOT` where a caller exports one, instead of resolving it with `git rev-parse` on every invocation. Measured on CI 2026-09-25: one board build spawned `git rev-parse --show-toplevel` 21 times out of 42 git processes, which `plan-read-shape.test.mjs` caught as the spawn count crossing its bound. After the change the same build makes 18 git processes with one toplevel resolution. A stale or non-directory value falls back to asking git, so a wrong export cannot silently answer from another repository.
