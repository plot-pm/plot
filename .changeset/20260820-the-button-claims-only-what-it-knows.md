---
"@plot-pm/board": minor
---

board: the Start work button claims only what it knows

The button's transient message was *no change — see log*, and it was wrong
twice over. It asserted a FAILURE the button cannot know happened: a dispatch
that prepared a worktree, pushed a booking and started an agent leaves
`waveSummary.claimed` unmoved for longer than the button waits, so the honest
message on a working dispatch was *no change*. And it offered the recourse as a
TRANSIENT log path — rendered in component state — that the next re-render, the
row moving, or a tab switch destroyed, so a reader told to *see log* found no
log to see.

The button now says only what it knows: it dispatched, and the next pulse
re-derives from git. The message is *Agent work will show up shortly* and
nothing more, in a neutral colour rather than an amber warning, and the row
travelling to WORKING is the confirmation. It still reports a real refusal — a
non-2xx from `/api/dispatch` — in the server's own words.

The dispatcher log that *see log* pointed at now has a home that outlives the
click: a `Status` entry in the row's `...` menu, present whenever a dispatcher
log exists for the plan. It reads the log through a new `GET /api/dispatch-log`
route — the sibling of `/api/worker-log`, one file over: that serves the
AGENT's console (`.plot-worker.log`), this serves the DISPATCHER's own record
(`plot-dispatch-<slug>.log`), keyed by slug and rendered in a focused
`DispatchLogModal` that reuses the worker log's escaping-`<pre>`, truncation
notice and path footer.

Presence rides one `stat` per card (`card.hasDispatchLog`), never the log's
contents: the pulse says a dispatcher log exists and where, and the body travels
only on demand when a reader opens the entry — the same discipline the worker
log and the worktree list already keep.

No skill version bumps: this is a board-side change only. Nothing under
`skills/` changed but the generated `board-server.mjs` artifact, which is
rebuilt output rather than authored skill content.
