---
'plot': minor
---

`plot-host.sh`'s `runs` and `run-for-sha` dispatch on the `CI` key rather than the git host, so a Jenkins repository reaches `jenkins_build_map` and a repository with no CI connector exits 4 instead of printing an empty run list.

<!--
plan: docs/plans/2026-09-08-the-ci-connector-is-jenkins.md
bumps:
  skills:
    plot: minor
-->
