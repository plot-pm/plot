---
'@plot-pm/board': minor
---

Plan cards on the planning board and in swimlanes render through one shared card from a new domain value, `CardFacts`, in three sections: a header with the kind icon, the ticket number and title, and a meta line of type and related items; a status panel with the plan's phase, slice progress and PR checks; and a footer with the assignee, the age and the actions. Every item a card names is a link: the ticket and the branch, PR and build open on the host, and the sprint, story and plan open their view on the board, while a count such as *2 PRs* opens a list of links. A sprint reads as its release target and title. A disabled action is a focusable control whose reason shows on hover and on keyboard focus. A plan's assignee is its `Assignee:` line, else the person on its newest `Started:` record. An unread fact reads as unknown instead of as zero.

<!--
plan: docs/plans/2026-11-06-one-card-grammar.md
-->
