---
'@plot-pm/board': patch
---

Vendor `plot-budget.sh` into the npm package. `plot-host.sh` sources it as a `$here` sibling, and without it every budget function is undefined — `graphql_budget_spent` calls `budget_rate`, so every `pr-state` in the npm layout would route on a `command not found`. The same shape as `plot-transcript-quiet.sh`, which the list already carries by hand because a gate derived from the server's own spawns cannot see a sourced file.
