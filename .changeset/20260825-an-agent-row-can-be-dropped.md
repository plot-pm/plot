---
'@plot-pm/board': minor
---

board: an agent row can be dropped

A broken agent row (stalled or unknown state) now shows "Drop this agent" —
the manual reconciliation for registry entries the automatic resolver cannot
clear.

A settled worker whose worktree was removed manually, or whose manifest
outlived its process, cannot be cleared by the automatic cleanliness
resolver — it checks the worktree, and no worktree means no answer. This
control is the escape hatch: it removes the manifest so the WORKING section
stops showing a row for an agent that is gone.

The endpoint refuses to drop a live worker (running or waiting state). The
registry is a record, not a killswitch.

The interaction is arm/confirm: first click arms the button, second confirms,
click elsewhere or Escape cancels. A failed drop keeps the row and shows the
error message.
