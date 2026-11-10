---
'@plot-pm/board': patch
---

fleetd and the board read branch tips, the default branch, the current branch, remote heads and the worktree list from the files under `.git` instead of starting a `git` process for each question; a reftable repository, a moved git directory or a name the file reader does not cover still asks git, and every destructive action still starts git.

<!--
plan: docs/plans/2026-11-09-refs-from-files.md
-->
