---
'plot': patch
---

The decision gate normalises the case of a Kind cell, names a kind it does not know, refuses a row whose cell count differs from the header's, and says "N scripts are not launchers" instead of "N scripts still decide or orchestrate". `rows()` lowercases the Kind cell once at the read boundary so `counted()` and the evidence filter in `report()` see one spelling; a cell count that lands on no known kind is reported separately from an unknown kind, naming the row in both cases. `push` mode on `check-decision-count.sh` and `check-shell-lines.sh` now retries a missing `before` SHA with one `git fetch --no-tags origin <sha>` before falling back to `HEAD^1`, and says so, rather than reporting an absent-but-real SHA as "not a commit in this clone".

<!--
plan: docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md
-->
