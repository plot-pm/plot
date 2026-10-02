---
'plot': patch
---

A host timeout no longer tells the reader to log in. `host_failure_kind` in `plot-host.sh` answers a fourth word, `timeout`, for `HTTP 502`, `HTTP 503`, `HTTP 504` and GitHub's *couldn't respond to your request in time* — tested after the two rate-limit patterns, so a message carrying both a limit phrase and a 5xx status still reads as throttled. `pr_list_failed` gains a matching arm: it prints `host timed out`, says the server took too long and the next refresh asks again, names no `auth login`, and exits 3 like every other non-limit failure.

#1087: the board's rich PR listing sometimes ends in a GitHub GraphQL 504, and the banner told the reader to run `gh auth login` — a server-side timeout is not a login problem, and the advice sent a reader to a command that does nothing.

<!--
plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md
bumps:
  skills:
    plot: patch
-->
