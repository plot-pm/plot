---
"@plot-pm/board": minor
---

board: name the master agent's branch on the Agents tab

The branch chip that lived in the header named the SERVER's checkout,
not the operator's. An operator on `bug/a-head-counts-its-own-waves` read
"main" and asked why — the chip answered the wrong question. "Where am I"
should not be answered by "where the server is".

This change:
- Removes the branch chip from the header entirely
- Adds `masterAgentBranch` to FleetSchema (names the main checkout)
- Adds `branchUrlBase` for client-side URL construction
- Implements TTL-cached reading of the main checkout's branch (5s)
- Renders a Master Agent row on the Agents tab (above sections)
- Rewrites tests to assert the new contract

The master agent branch is read from the FIRST worktree (the main
checkout), not the server's worktree, using the same TTL pattern as
server-info.ts to keep git forks off the request path.

<!--
bumps:
  skills:
    plot: patch
-->
