---
'plot': patch
---

The tracker port gains `issueOpen({ title, body, labels })`, its second sanctioned write after `statusWrite`. `plot-host.sh issue-open` opens one issue on a `jira` or `github-issues` tracker and prints its key; `trackerJira` and `trackerGithub` call it, and `trackerGitHost` and `trackerNone` answer `unaskable` with their reason. The port, `plot-host.sh` and `/plot-deliver` docs now name two writes instead of one.

<!--
plan: docs/plans/active/the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot-deliver: patch
-->
