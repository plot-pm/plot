---
'plot': patch
---

The board probe finds a Jenkinsfile where a repository keeps it. `plot-board-probe.sh` tested one path, `$git_root/Jenkinsfile`, so a repository keeping its pipelines in a directory read as having no CI at all — `proposeCi` answers `silent`, `/plot-board-setup` writes no `CI:` key, and the Jenkins instance question is never asked; the repository that reported this keeps three under `.build/pipelines/website/<pipeline>/Jenkinsfile`. It is now a `find` bounded at depth 5, pruning `node_modules`, `.git` and the configured `Worktree root`. Five is measured rather than counted: `-maxdepth` counts path components from the start point, not directories, so that file is four directories down and `-maxdepth 4` finds nothing — an earlier draft made exactly that off-by-one, and the three readings are recorded beside the search. The cost was measured on this repository, three runs each: bounded with exclusions 7-8 ms, unbounded with the same exclusions 7 ms, unbounded with no exclusions 70-83 ms. The exclusions are worth about tenfold and the bound is worth nothing measurable, so the script states that it is kept as a bound on meaning rather than on speed. No naming exclusion beyond `node_modules` — refusing a Jenkinsfile in a test fixture directory was specified, attempted and withdrawn, because no rule survived a repository that genuinely keeps a pipeline under `test/`. `gh_workflows` is untouched: it tests the one path GitHub requires.

<!--
plan: docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md
bumps:
  skills:
    plot: patch
-->
