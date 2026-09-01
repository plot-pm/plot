---
'plot': patch
---

CI reports how many files in `packages/board/src/server` import `@plot-pm/domain`, and fails on nothing. The sprint moves rules out of that tree and into the domain; this is the one line in the log that says how far that has got. It read 8 of 45 when it was added, against a baseline of 2 of 36 measured 2026-08-30.

It carries no threshold because the number measures file layout rather than adoption: a refactor that merges two importing files lowers the count and improves the code, while a file that imports without calling raises it and proves nothing. So there is no floor, no warning band, and no failure path — the step exits 0 whatever it reads, and its own comment says why.

It is its own step rather than an addition to the alias gate beside it. A report sharing a step with a gate reads as enforced, and the next person to watch the number fall would go looking for a regression that did not happen.
