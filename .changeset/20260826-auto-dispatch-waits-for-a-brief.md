---
'@plot-pm/board': patch
---

Auto-dispatch does not start a wave whose brief is absent from `origin/main`,
and names the branches it skipped.

The check reads git rather than the filesystem: a board checkout 20+ commits
behind main held 150 briefs against main's 157, so an `existsSync` would have
refused seven starts that should have happened. `git cat-file -e` costs ~8-27 ms
per branch, ~100-300 ms for eleven candidates against the 5 s pulse cadence.

`planAutoDispatch` stays pure — `missingBriefs` is injected by
`maybeAutoDispatch`, which is already the impure side.
