---
'plot': patch
---

The plan-state comment write fixes three defects: two waiters on one stale lock now leave one holder, writes on different issues keep both body-hash entries, and a comment edited with `\r\n` line ends is read back. An identical second write issues no label or comment call, and still reads the comment back once when it omits a field.

<!--
plan: docs/plans/2026-11-03-open-plot-review-findings-from-the.md
bumps:
  skills:
    plot: patch
-->
