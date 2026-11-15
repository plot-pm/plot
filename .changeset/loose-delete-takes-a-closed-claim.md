---
'plot': patch
---

`loose-delete` deletes a claimed branch that also holds work, where the host's PR for it is closed and the host merged no PR for it. Before, `loose-delete` refused it as `claimed` and `release-claim` refused it as work, so no controller could delete it.
