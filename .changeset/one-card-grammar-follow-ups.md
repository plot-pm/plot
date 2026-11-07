---
'@plot-pm/board': patch
---

The plan card keeps a running action in the closed More actions menu, shows a disabled action's reason as plain text with no links in its tooltip, links a sprint to `/?sprint=<slug>`, shows the dispatched confirmation in the card's message row for 5 seconds after a refresh removes Start work, keeps Start work disabled with *no fleet scan yet* on a started plan before the first fleet scan, and links a ticket only for an `http:` or `https:` address.

<!--
plan: docs/plans/2026-11-06-one-card-grammar.md
-->
