---
'plot': patch
---

fleetd's idle PR beat starts no process. The default-branch read asks `git ls-remote` only where the local `origin/<default>` ref or the PR index's newest `mergedAt` changed, or where the held reading is due for a re-ask. The IndexMonitor parses the plans with `plot-config.sh` and `plot-plan-meta.sh` only where `origin/<default>` moved.
