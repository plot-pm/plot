---
'@plot-pm/board': minor
---

A PR row reports every condition it is in, not only the most blocking one. `pr.states` is an ordered set, most-blocking first, and `pr.state` is now derived as its head rather than computed beside it — so a PR that both conflicts and has a failed build no longer loses the build failure before the row is built.
