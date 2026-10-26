---
'plot': patch
---

A `--brief-only` implement run now books its hand-off brief and the plan's `Started:` record through `plot-brief-book.sh`, a JS entry point that writes, commits and pushes both in one disposable worktree cut from a freshly fetched default branch — never opening the operator's main checkout. Three runs on 2026-10-26 wrote both directly into that checkout and left byte-identical leftovers there that made `git merge --ff-only origin/main` refuse; `startImplement`'s end handler now also logs any path the run added to the main checkout, by name, without removing anything.

<!--
plan: .plot/briefs/implement-books-the-brief-in-a-worktree.md
bumps:
  skills:
    plot-implement: minor
-->
