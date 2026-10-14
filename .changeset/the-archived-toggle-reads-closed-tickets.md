---
'@plot-pm/board': patch
---

The Show archived toggle on the Discovery tab reads every closed ticket through `GET /api/issues/closed` once per toggle or page load, lanes them into Done through the domain's `ticketLanes`, and the route reports a held or failed read as its reason.
