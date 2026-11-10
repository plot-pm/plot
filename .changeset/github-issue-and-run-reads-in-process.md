---
'plot': patch
---

The GitHub tracker's open, closed and changed issue reads and the GitHub Actions `runsForSha` read can run in-process over the GitHub API client, sending the requests `gh issue list` and `gh run list` send; a corpus test holds both against `plot-host.sh issue-list` and `runs-for-sha`. Nothing in production composition uses them yet.

<!--
plan: docs/plans/2026-11-09-github-reads-in-process.md
-->
