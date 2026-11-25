---
'@plot-pm/board': patch
---

The board and the fleet find `.plot/state` in a repository checked out as a git submodule. The state home now follows the common git directory's `core.worktree` where that directory is not a `.git` directory, so a submodule's working tree is its own state home instead of reading as unread.

<!--
plan: docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md
-->
