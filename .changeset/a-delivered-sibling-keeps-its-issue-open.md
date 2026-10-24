---
"@plot-pm/board": patch
---

Fixed `/plot-release` closing a shared issue early (#2480, finding from #2374): the sibling read covered only the Active index, so a sibling plan Delivered but not yet released was invisible and its issue closed anyway; the Jira status write ran before the sibling read with no skip list, so it could change a shared issue the close then left alone; a failed or unparseable sibling read returned an empty set, which read as "no sibling" and closed every shared issue; and a `JSON.parse` with no guard could throw after the release's push had already landed on `main`. The sibling read now covers the plan directory (Active and Delivered both), one skip list reaches both the Jira status write and the close, an unreadable or unparseable sibling stops the issue step and reports it while the release still returns success, and parsing goes through one guarded reader.

<!--
plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
bumps:
  skills:
    plot: patch
-->
