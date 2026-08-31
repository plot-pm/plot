---
'plot': minor
---

The BuildMonitor follows the run. A third monitor joins every dispatched worker
and reports four findings about a build — `build failed`, `build passed`,
`build needs approval`, and `head moved` when the run in flight is for a commit
the branch has already passed. A green result for superseded code is worse than
none, because it invites a merge of the wrong thing. It polls nothing while no
run is live, which is what makes a 30-second cadence against a host affordable,
and `plot-host.sh` gains one operation — `run-for-sha` — which reports the run
for a sha and names the commit that run is actually for.

<!--
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->
