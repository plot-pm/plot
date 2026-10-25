---
'@plot-pm/board': patch
---

`plot-host.sh issue-list --title-has` now has shell test coverage for its `gh --search` text, its open-only refusal, and the Jira/Bitbucket exit-4 arms; `openIssueOfPr` now names the tracker search index's lag on a just-opened issue as a known risk to its duplicate guard. No runtime behaviour changes.

<!--
plan: docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md
-->
