---
'plot': patch
'@plot-pm/board': patch
---

The board's open-issue list says why it is absent instead of reporting an outage. `plot-host.sh issue-list` and `issue-view` exit 4 for a `bb` whose `--help` lists no `issue` command (Quatico `bb` 1.9.0), with a sentence that names the `Tracker` config key; craftamap/bb at a version other than 0.6.0 keeps the format refusal. A new domain rule, `issueSource`, decides who answers the list: the git host where no tracker is declared, the declared tracker where a connector lists it, and nobody, with a reason, for a tracker no connector lists. The board shows that reason in WAITING ON YOU rather than "Open issues could not be read". Fixes #1131.

<!--
bumps:
  skills:
    plot: patch
-->
