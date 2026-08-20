---
"@plot-pm/board": minor
---

board: an agent outlives its branch

The dispatcher writes a manifest under `.plot/agents/<session>.json` at launch,
and the board reads them back joined to their session transcripts. Together they
make an agent something the board can list **with no branch at all** — the state
`waiting` requires and no worktree can express.

**Keyed on the session id, not the branch.** Everything the board knew about an
agent lived inside a worktree: `.plot-worker.pid` is a file in it, and the
transcript directory is derived from its path. So an agent that finishes one
branch and takes another lost every identity the board held. The session id
survives that.

**The dispatcher mints the id** and exports it as `PLOT_SESSION_ID`, so a
`Worker command` can forward it (`claude --session-id "$PLOT_SESSION_ID"`) and
the runtime's transcript lands where the manifest points. This repo's command
carries no `--session-id`, so minting keeps it launch-time knowledge rather than
a guess at the newest file in a directory that held one to eight of them.

**The manifest records only launch-time facts** — session, branch, worktree,
command, startedAt. No pid: a pid describes the process, is meaningless once it
exits, and was measured still being shown for a worker gone for hours. No model
or context: those belong to the runtime and are read from the transcript.

**A missing transcript costs fields, not entries.** Model, context and last
activity are absent; the agent is still listed. The format is the runtime's
private business and may change.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
