---
'@plot-pm/board': patch
---

A branch in state `blocked`, `waiting` or `unknown` that no worker holds now reads NOT STARTED with its own sentence, naming the branch it waits for, instead of *commits, no PR ever opened* in WAITING ON YOU. A branch whose PR closed stays in its open section while its worker is running or waiting, and returns to DONE when no agent is live.
