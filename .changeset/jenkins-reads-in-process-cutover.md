---
'plot': minor
---

fleetd reads the Jenkins checks of a Bitbucket or GitHub repository with `CI: jenkins` in-process: the rich listing overlays the branch colours and the commit-bound builds through the Jenkins client, and the idle pass starts no `jen` and no `plot-host.sh` Jenkins read. A caller with no Jenkins client, and `PLOT_HOST_TRANSPORT=shell`, keep the shell reads.

<!--
plan: docs/plans/2026-11-16-jenkins-reads-in-process.md
bumps:
  skills:
    plot: minor
-->
