---
'plot': patch
---

A Bitbucket command in `plot-host.sh` exits 5 (throttled) where its last `bb` call exited 75, which `bb` uses for its hourly ceiling, a pause and a 429; a GitHub, Jira or Jenkins command keeps exit 3 whatever its stderr says. The `limit` command on Bitbucket reads `bb rate-limit --json` and prints `requests`, `ceiling`, `paused_until` and `wait_seconds` beside the declared limit, and the host adapter reads them through `bbLimitReading`; where `bb` has no `rate-limit` command (1.13.0 and older), the line is the declared prediction as before. Every Bitbucket command reads `bb --version` once and refuses a craftamap `bb` with exit 3 and the install command; an older Quatico `bb` passes. Neither `bb --version` nor `bb rate-limit` records a budget row.

<!--
plan: docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md
bumps:
  skills:
    plot: patch
-->
