---
'@plot-pm/board': patch
---

The JS worker loop's restart keeps a pending hop, so the slice after a restart starts a new conversation and a new correction count (#1324). A restart onto the main checkout now needs its `skills/plot/scripts/` paths free of every uncommitted or untracked change, a locally rebuilt bundle included, and a main `HEAD` that contains the commit of the running bundle, so a loop does not move onto older code. Each blocked restart is logged once with its reason. A memory restart re-runs only the content the loop loaded. The `--self-check` builds the loop's ports and reads its configuration, and a candidate is rejected after two failed checks or one failed replace.
