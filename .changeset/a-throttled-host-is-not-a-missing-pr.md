---
'plot': patch
---

`plot-host.sh pr-state` on GitHub asks its REST fallback about the remote's own repository (`repos/{owner}/{repo}/…`), where it asked `repos/TODO/…` and read the 404 as "no pull request". A throttled GraphQL budget now yields the PR's real state when REST answers, and a non-zero exit with the host's reason when REST fails too, never `NONE`. `plot-review` refuses a failed PR-state read with "the host did not answer the PR state of #N: <reason>" and keeps "has no pull request" for a read that found none.
