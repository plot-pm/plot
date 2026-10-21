---
'plot': patch
'@plot-pm/board': patch
---

The Sprint/Release comparison no longer drops a Must Have whose Jira key is not on an `Issue:` line: it now resolves each item's key from a fixed three-source order — the plan's `Issue:` line, then its new `ticket:` frontmatter field, then the item's own text matched against `Ticket prefixes` — and reports any Must Have that still resolves to no key in a new `notCompared` list, named by item text, rather than folding it into `missingFromRelease`.

<!--
plan: docs/plans/2026-10-21-sprint-release-comparison-drops-must-haves.md
bumps:
  skills:
    plot-sprint: patch
    plot-release: patch
-->
