---
'@plot-pm/board': minor
---

Story cards on the Discovery board render in the card grammar's three sections. A story leads with its kind icon and the ticket number its `issue:` names, opens its status with its written status, labels a status behind its plans, folds two or more plans or sprints into one count that opens a list, and offers *Add plan*, which starts `/plot-idea` for a plan inside the story through `POST /api/story-plan`. A story names its ticket in `issue:` (`jira:` is still read), accepted only for this repository's own issues or a Jira project that `Ticket prefixes` or `Tracker: jira <url> PROJ, OPS` declares, and a ticket that a committed story answers links the story and offers no *Create story*. The story overlay renders only `http:` and `https:` links. The plan card's *More actions* menu focuses its first enabled action and opens a disabled action's reason beside it, and a work bar past 24 slices fills one continuous track.

<!--
bumps:
  skills:
    story-tracking: minor
plan: docs/plans/2026-11-06-one-card-grammar.md
-->
