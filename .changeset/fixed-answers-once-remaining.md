---
'plot': patch
---

The remaining helpers that ask git for the common git directory or the top level read `PLOT_GIT_COMMON_DIR` and `PLOT_REPO_ROOT` first: `plot_repo_root` and `plot_exclude_desk_root` in `plot-desk-root.sh`, `plot_desk_exclude` in `plot-worker-state.sh`, `plot-agent-settings.sh`, and `plot_env_file` in `plot-host.sh`. A node bundle reads the same two variables before it starts `git rev-parse`, and the `plot-review.mjs`, `plot-reap.mjs`, `plot-design.mjs` and `plot-verify.mjs` entries ask through the same held answers. An answer is reused only for a directory of the same repository, checked through its `.git` directory or `gitdir:` file; a desk of that repository reuses it, and another repository, a missing value or a value that is no directory asks git as before. The shared check lives in the new sourced helper `plot-git-dirs.sh`.

<!--
plan: docs/plans/2026-11-08-fixed-answers-once.md
-->
