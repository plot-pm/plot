---
"plot": patch
---

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
    plot-fleet: patch
-->

plot: a worker has one state, not one per reader

`worker_state()` in `plot-dispatch.sh` and an inline copy in
`plot-fleet-scan.sh` classified the same worker independently — same
`.plot-worker.pid` read, same `kill -0`, same rejection of pid `0`, same
exit-code mapping. They were written to agree and were never asked the same
question about the same worktree, so nothing held them together.

They had already drifted. A non-numeric `.plot-worker.exit` read as `ended`
in the scan and `failed (exit abc)` in `plot-dispatch` — two verdicts from
one fact, where whichever a reader consulted first would win. Found by
running both against one fixture, which is a thing no test had done before.

The classification now lives once, in `plot-worker-state.sh`, sourced by
both. It returns facts — state, pid, exit code — and renders nothing: the
two output shapes are real interfaces and both survive unchanged.
`--status` still prints prose for a person (`failed 1234 (exit 3)`),
`--json` still emits tab-separated fields for a machine (`failed\t1234\t3`).

The drift is resolved toward `ended`, on the principle the scan already
stated for the empty case: an unreadable record licenses no verdict, and
"failed with code abc" invents one exactly as much as "finished" would. No
previously asserted behaviour changes — the scan's suite already pinned
`ended`, and `plot-dispatch`'s pinned only `0`, `3`, and an absent file.

**No behaviour changes otherwise.** The six states keep their names and
meanings. `elsewhere` stays the scan's alone: it answers "this machine has
no worktree to look in", asked before there is anything to look inside.

The new contract test drives BOTH consumers from ONE fixture across every
state — that agreement is the point — and asserts structurally that the
liveness check exists once, so a re-inlined copy fails rather than drifts.
It also pins that every answer carries three tab-separated fields: POSIX
`cut` prints a line unchanged when it holds no delimiter, so a bare `none`
would put the state word in the exit-code slot without erroring anywhere.
