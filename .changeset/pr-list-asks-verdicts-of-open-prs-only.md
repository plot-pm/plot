---
'plot': patch
---

`plot-host.sh pr-list` takes a `--rich-open` flag that asks the rich fields of the open pull requests and returns every other row plain, in the same shape. On GitHub it makes two calls and a merged or closed row carries `checks: "unknown"`, `mergeable: "unknown"`, `review: ""` and `failing_checks: []` — the absent values that mean *not asked*, never *no checks*. The plain GitHub arm now also answers `draft`, `url` and `updatedAt`, so a terminal row carries every field a rich row carries. A failure in either call prints no rows and exits non-zero. On Bitbucket the flag answers exactly as `--rich`, because that arm asks the host no verdict.

<!--
plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md
bumps:
  skills:
    plot: patch
-->
