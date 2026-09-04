---
'plot': minor
---

A dispatched worker names its session, so its transcript can be attributed to it.

`plot-dispatch.sh:774` has exported `PLOT_SESSION_ID` and `plot-worker-loop.sh:661`
has printed the flag in its own diagnostic, but the invocation that runs the agent
passed it zero times. So no transcript belonged to any agent: the board could not
join an agent's row to its stream, resume reported itself unavailable, and
`plot-worker-loop.sh:1063` ended workers reporting in prose that nobody could tell
what they were doing. `.plot/worker-prompt.sh` now passes
`--session-id "$PLOT_SESSION_ID"`, and the two `Worker command` examples an
adopting repo copies from show it.

An absent id passes no flag. `--session-id ""` is a malformed argument rather than
a missing one, and no id is invented — an unanswerable question is not answered
zero, the direction `plot-worker-state.sh` already takes.

The guard is `${session_args[@]+"${session_args[@]}"}`, and the form is not
cosmetic. Measured 2026-09-04 on bash 3.2, which is `/bin/bash` on every macOS and
reachable because the loop sources this file through `bash -c`: a plain
`"${session_args[@]}"` over an EMPTY array expands to one empty argument, and under
the loop's `set -u` aborts before a single prompt is sent. Bash 5 does neither, so
a test on the default shell alone passes the defect — which is why the test asserts
both versions, and why against the naive form 5.3 reports three passes while 3.2
reports two failures.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
