---
'plot': patch
---

The reaper now asks whether an agent runs at a desk, the same question `plot-dispatch.sh --stop` asks, instead of only whether the recorded pid answers `ps`. That pid is the wrapper shell, which outlives its agent, so a desk whose agent had exited read `worker alive` to the reaper while `--stop` answered `finished`, and neither could act on it. Both reading sites, the reap loop and the dirty-tree sweep, read `plot_worker_state`: `running` is live, `finished`, `failed`, `ended` and `none` are not, and `waiting` and `stalled` are left to the marker and dirt readings. Because this lets the reaper remove more desks, a new `unpushed-commits` refusal keeps a desk holding commits no remote has and names them. The reading excludes the head the host merged, so it still answers after the host deletes the merged branch, and a count that cannot be taken keeps the desk. On a merged desk the guarantee holds where the desk CONTAINS the merged head; where it does not — a squash merge rewrites the commits, and some host answers carry no head at all — the host's answer that the work landed is taken as decisive, because the alternative reading reports every commit the branch ever had and would hold the desk forever.

<!--
plan: docs/plans/2026-09-27-one-answer-to-is-a-worker-running.md
bumps:
  skills:
    plot: patch
-->
