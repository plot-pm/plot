---
"plot": patch
---

Fixed four defects in the Bitbucket `mergeable` fold behind `pr-state` and `pr-list --rich` (#2481). A non-OPEN row (MERGED, CLOSED, NONE) now prints unchanged with zero `jq`/`git`/`node` calls, instead of running the fold's full local-git check for a settled row. `--repo` naming a different repository than the current checkout's `origin` now answers `unknown` with a reason instead of running `git merge-tree` against the wrong local clone. The `git fetch` of the base is bounded to 10 seconds (`BB_FETCH_BOUND_S`, a new constant — no nearby config key exists for it), and a timed-out fetch reads `unknown`, never `false`; the bound also runs the fetch in its own process group so a child it spawns (an askpass helper, ssh, a credential helper) cannot outlive the kill and hold a caller's pipe open past the bound. `pr-state`'s two call sites now capture `bb_state_row`'s exit status immediately after the command substitution that was silently discarding it, so a failure inside `bb_state_row` now fails the op instead of printing the pre-fold row.

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills:
    plot: patch
-->
