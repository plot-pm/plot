---
'@plot-pm/board': patch
---

board: the registry drops a settled worker

An entry in the agent registry is now dropped when BOTH conditions hold:
1. The session has ended — the state is anything except `running`.
2. The worktree is clean — no uncommitted changes AND no unpushed commits.

Either condition outstanding (live session OR dirty/unpushed) and the entry
stays visible. A worker with a dirty worktree and an ended session is still
reported with what it is holding; a worker with a clean worktree and a live
session is still working. Only a worker with nothing outstanding disappears.

This cleans up the Agents tab after a fleet run where all workers finished
successfully — entries that have completed their work and pushed their changes
no longer clutter the panel.

"Clean" applies the same exclusions as `plot-worker-state.sh`: editor leftovers
(`.tmp1`, `.swp`), Plot's own records (`.plot-worker.*`), and tool scratch
directories (`.playwright-mcp/`, `.plot/agents/`, `.omc/state/`) are ignored.

The feature is opt-in in the registry API: callers that want all entries simply
omit the `cleanliness` option. The board passes `bashCleanliness` to enable it.
