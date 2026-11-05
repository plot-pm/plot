---
'plot': patch
---

`POST /api/restart`, `POST /api/continue` and the agent panel look a branch up in the last finished scan when the board's current scan is partial and does not list it, and refuse `pulse-partial` instead of `unknown-branch` when neither scan lists it.
