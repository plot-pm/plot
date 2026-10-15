---
'@plot-pm/board': minor
---

A plan card and a story card show an owner, and a plan card shows its type from the domain. `planCardView` gives a plan card its type word, lowercased, and its owner: the `Assignee:` before approval and the approver named in the `Approved:` record once approved. `storyCardView` gives a story card its author. Both resolve the name through the `People` directory or show it as written where undeclared. A plan with no `Type:` shows no badge, and a plan or story with no readable name shows no owner. A story has no type source, so a story card shows no type badge.

<!--
plan: docs/plans/2026-10-15-discovery-and-planning-cards-show-the.md
-->
