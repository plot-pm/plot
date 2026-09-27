---
'plot': patch
'@plot-pm/board': patch
---

`plot-dispatch.sh --release <branch>` returns an abandoned claim to the queue. It clears the `branch` field of every agent manifest in the `Agent registry` directory that names the branch, then deletes `origin/<branch>`. Manifests go first, so a failed ref deletion leaves the ref still locking the slice. Deleting the ref by hand clears only the first record, and a manifest keeps naming a slice the queue offers again. `--release` refuses on an open or merged PR (asked first), a host it cannot ask, `--offline`, a live worker (named by pid), a file-changing commit on the remote branch, unpushed commits or uncommitted changes on the local desk, and a `PLOT-BLOCKED` marker. A refusal writes nothing, and the desk is never touched. `--stop` still keeps the claim; `--help` and `/plot-dispatch` state the difference. `clear_manifest_branch` moves from `plot-worker-loop.sh` into the sourced `plot-agent-manifest.sh`, so the loop and the dispatcher share one writer. The controller gate admits `--release`, which has no endpoint. The board package vendors `plot-agent-manifest.sh` beside `plot-dispatch.sh`, so `--release` works in the npm layout.

<!--
plan: docs/plans/2026-09-26-a-claim-is-released-not-deleted.md
bumps:
  skills:
    plot-dispatch: minor
-->
