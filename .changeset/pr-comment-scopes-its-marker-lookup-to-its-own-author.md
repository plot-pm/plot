---
'plot': patch
---

`plot-host.sh pr-comment` and `issue-comment` now scope their marker lookup to the comment's own author (the signed-in `gh` CLI identity, read the same zero-cost way `budget_account` already does) through one shared `gh_marker_comment_id` function, so a PR participant pasting the same marker substring into their own comment can no longer be mistaken for the script's prior post. A listing that cannot be read still fails rather than falling through to "no marker found." The `prComment` port doc now names that failure mode.

<!--
plan: docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md
bumps:
  skills:
    plot: patch
-->
