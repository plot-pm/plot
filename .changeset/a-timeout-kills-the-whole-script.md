---
'plot': patch
'@plot-pm/board': patch
---

A script the board runs that exceeds its timeout no longer leaves its subshells and children running. Each script now leads its own process group, and a timeout or an output overflow sends SIGKILL to the whole group. On a Bitbucket estate a timed-out fleet scan had kept its `plot-host.sh pr-list` children alive under pid 1, holding the account while the next scan timed out beside them, so the Agents tab never completed a scan.

<!--
bumps:
  skills:
    plot: patch
-->
