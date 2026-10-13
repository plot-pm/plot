---
'plot': patch
---

The tracker port gains `issueOpen({ title, body, labels })`, its second sanctioned write after `statusWrite`. `plot-host.sh issue-open` sends one create request to a `jira` or `github-issues` tracker and prints the tracker's answer; any other tracker exits 4 with the reason. `trackerJira` builds the Jira request in the first `Ticket prefixes` project with the issue type the new `Tracker issue type` key names (default `Task`), and `trackerGithub` passes the title, body and labels to `gh issue create`. Both read the identifier from the answer, and a `failed` whose refusal starts with `the issue may exist: ` marks a call that may have opened the issue. `trackerGitHost` and `trackerNone` answer `unaskable` with their reason. Every Jira op in `plot-host.sh` now asks through one `jira_ask` helper. The port, `plot-host.sh` and `/plot-deliver` docs name two writes instead of one.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot: patch
    plot-deliver: patch
-->
