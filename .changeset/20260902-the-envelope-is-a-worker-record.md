---
'plot': patch
---

Ignore `.plot-worker.envelope.json` beside the six sibling worker records already listed. The envelope was added later and its `.gitignore` line was not, so every dispatched desk carries one untracked file — measured 2026-09-02, 18 of 21 desks were dirty for that reason alone, and `plot-reap.sh` refuses a desk with uncommitted changes.
