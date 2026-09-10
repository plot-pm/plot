---
'plot': patch
---

`/plot-fleet --start` records that it finished, and `--status` names three states instead of two. The measured failure, 2026-09-09: the fleet was stopped for hours and nothing said so — `launchctl list` showed no job while the plist sat on disk correct at 5344 bytes, and one `launchctl bootstrap` restored it. The cause is a non-atomic `--start`, which fills the unit, bootstraps, then cuts agent desks — one `git worktree add` each, and that is the slow part — so a run interrupted there left unit present, launchd unaware, and a state with no name. A completion marker under `.plot/state/`, not a lock: a lock says *a run is in progress* and answers wrongly for a run that died, while absence answers *the last run did not finish* with no timer and nothing that must tell a kill from a crash. It is read together with the unit file, which settles the fresh-clone case, and `--status` prints each state's own repair because an operator who reads *not loaded* and runs `--start` pays for the wrong one. `--status` still starts nothing, in every state.

<!--
plan: docs/plans/2026-09-09-the-supervisor-is-loaded-or-it-is-reported.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
