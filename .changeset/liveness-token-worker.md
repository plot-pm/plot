---
'plot': patch
---

The node worker wrapper makes a liveness token for each agent launch: a FIFO at `.plot-worker.token.fifo` in the desk, handed to the agent as fd 3 and passed on by the worker loop to the harness it starts. fleetd reads the token without blocking and decides the worker's liveness with `workerLiveness`: an exit record not older than the token answers the process ended, a released token answers dead, and a held token answers live or, where the recorded pid does not answer, a stray holder that starts no restart until `Worker bound` has passed. A desk with a token reads no start time, and its `orphaned` process walk runs only when the token or the loop's pass record changes. A desk with no token keeps the start-time reading, and its board row says "liveness by start time". A released token with no exit record writes one line to the desk log and to `.plot-worker.monitor.agent.jsonl`. `plot_desk_root` exits 3 and names the type for a desk root on `nfs`, `smbfs`, `cifs`, `afpfs` or `webdav`.

<!--
plan: docs/plans/2026-11-09-liveness-token.md
-->
