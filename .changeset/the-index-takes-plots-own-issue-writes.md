---
'plot': patch
'@plot-pm/board': patch
---

An issue Plot opens or a status Plot writes now reaches the issue index within one fleetd beat (5 s) instead of the next issue pass.

After the tracker answers `opened` or `written`, `plot-review`, `plot-verify` and `plot-issue-status` append the changed row to `issue-writes.jsonl` beside `issues.json`. fleetd drains the spool on every base beat and folds it with `issueWriteThrough`; `refreshIssueIndex`'s store stays the only writer of `issues.json`. The fold leaves `at`, `nextAt`, `backoffUntil`, `answer` and `fullReadAt` as held, adds 1 to `requests` per write on the held connector and account, moves a `Done` row from `rows` to `closed.rows`, and creates no index where none is held. The spool is capped at 256 KiB.

<!--
plan: docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md
bumps:
  skills:
    plot: patch
-->
