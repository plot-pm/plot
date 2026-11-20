---
'plot': patch
---

The Fleet card's registry fact counts a worktree with no manifest as an agent only where a worker ran on it. A worktree with no `.plot-worker.pid` record, such as a checkout a person made, reads `none` and is left out of both counts, so `0 of 23 agents have a registry file` no longer shows when the fleet runs no agent. The registry read reports these desks as `checkoutCount`, and the Agents view still lists them as rows. Where no counted agent exists, the card prints no registry fact; the earlier warning `the registry holds no agent file` is gone.

<!--
bumps:
  skills:
    plot: patch
-->
