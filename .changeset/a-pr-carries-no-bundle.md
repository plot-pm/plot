---
'plot': patch
---

A pull request no longer carries a generated board bundle. `scripts/check-no-bundle-diff.sh` refuses a PR's diff against the merge base that changes one, printing the merge-base restore or a `git rm` for a path the base never had; a `PreToolUse` commit-time gate (`plot-bundle-commit-gate.sh`) refuses the same shape before the commit exists at all. CI now builds the bundles before `validate`'s and `corpus`'s first test that loads one, and `scripts/main-bundles.sh`'s `pr` mode warns on a stale build rather than failing it, since a PR's checkout holds `main`'s build and not its own. One sourced filter (`bundle_paths`/`exclude_bundle_paths` in `plot-desk-dirt.sh`) excuses a rebuilt bundle in every desk-dirtiness reader — `plot_worker_dirty_filter`, `desk_dirt`, the board's `bashCleanliness`, and the porcelain reads in `plot-dispatch.sh` and `plot-fleetctl.sh` — and `reset_desk` restores the generated paths before its base checkout, so a locally rebuilt bundle no longer leaks a desk. The board's automatic artifact-conflict repair is switched off: `mayResolve` now refuses every `artifact-conflict`, since the rebuild it used to push would commit exactly what the new gates refuse.

`plot-install-prompt.sh` never overwrites an adopting project's worker prompt, so this repository's own copy under `.plot/worker-prompt.sh` was updated by hand alongside it.

<!--
plan: docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md
bumps:
  skills:
    plot: patch
-->
