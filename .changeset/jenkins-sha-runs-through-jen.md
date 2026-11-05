---
'plot': patch
---

Jenkins sha and build-status reads now go through `jen api`, the same transport every other Jenkins call in `plot-host.sh` already uses, rather than a raw `curl -u` basic-auth request. The old transport returned an HTTP 302 behind an OAuth2 proxy and read as `checksLookup: broken`; `jen` carries its own login state and reaches the same instances other `jen` calls already reach.

<!--
plan: docs/plans/2026-11-03-jenkins-sha-runs-build-status-fails.md
bumps:
  skills:
    plot: patch
-->
