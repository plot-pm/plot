---
'plot': minor
---

The desk and the slice's CI are watched by one monitor process rather than two. `DESIGN-process.md` §8 sets fleet control at `1 + 2N`, and both of these subjects belong to the SLICE — which is what an agent holds — so the BuildMonitor merged into the AgentMonitor's loop. A dispatched agent now runs three resident processes where it ran four.

**The merge keeps both cadences, which is the whole difficulty of it.** The loop wakes on the faster subject at 30 s and runs the desk pass every tenth wake at 300 s, so neither budget moves: the host is still asked about a PR every 300 s, and a build is still noticed within 30 s. Splitting the difference would break both — the desk pass asks a host on every pass, which is the rate problem 300 s exists to avoid, while a 300 s build pass would report a failure ten times later than the run that produced it.

**Both subjects run in one shell, in sequence.** A process substitution driven one line per wake was tried first and is the wrong shape: measured 2026-09-06, the writer blocks whenever the reader is mid-pass, and the loop that must notice its subject's death is the one doing the writing. A monitor that outlives its agent is the single property this loop may not lose. Running in-shell also keeps `settled_shas` in memory across passes — the second half of *it polls nothing when no run is live* — where a fresh shell per pass would spend a host round trip re-learning a published fact every 30 s per agent.

The collision between the two scripts is handled by saving around the source: both define `monitor_pass`, `sample_finding`, `publish` and `json_escape`, and both assign `published`, `since`, `findings`, `interval`, `monitor`, `worktree` and `pid_file` at module level. Without restoring the desk's own subject after the source, the loop watched whatever pid file the build monitor resolved from the environment.

`buildMonitorPid` is no longer written and is deliberately still read: manifests written before this change name a live pid there, and the process group is what `/plot-fleet --stop` walks to find everything an agent started. It retires itself on the next stamp.

Two sourced siblings joined the vendor list — `plot-build-monitor.sh`, which the merged loop now sources, and `plot-monitor-subject.sh`, which all three monitors have always sourced and which was on no list. Without the latter, `plot_monitor_wait` is undefined in the npm layout, so a monitor takes one pass and exits, leaving a worker that reads as monitored and is watched by nothing after its first second.

<!--
plan: docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md
bumps:
  skills:
    plot: minor
-->
