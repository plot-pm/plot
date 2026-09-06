---
'plot': minor
---

An agent handed a second slice starts a prompt on it. `plot-worker-loop.sh` now decides which session flag the prompt carries — `--session-id` where no transcript exists under the handle, `--resume` where one does — and exports it as `PLOT_SESSION_FLAG` beside the handle. The prompt file interpolates the answer and states no rule of its own, which is what keeps a project rewriting its own wording from reintroducing this: `.plot/worker-prompt.sh` hardcoded `--session-id`, and that id is minted once at launch, so the runtime answered `Session ID … is already in use` on the second slice. Measured 2026-09-05 on three agents at once, over an hour each, every exit code zero.

The probe self-corrects where a `wavesCount` branch would not: an agent whose first prompt never started has no transcript, so its second correctly creates — which is exactly the state those three were left in.

`run_bounded` keeps the prompt child's own exit code, which it collected and discarded. A prompt that exits non-zero without running keeps its slice and its desk, is retried against the `attempts` budget, and then ends the worker with an `unstarted` ending record — actor `agent`, the runtime's words in `detail` — a `PLOT-BLOCKED` marker and a non-zero exit, so `plot-worker-state.sh` answers `failed` instead of the loop falling through to its wait.

`update_manifest_on_hop` writes `resumeId`, which had one writer, no readers and a twin since dispatch minted it.

`plot-dispatch`'s documentation of the session contract says which half is whose: a one-shot `Worker command` creates a session and passes `--session-id`, and a looping one interpolates the flag the loop decided.

<!--
bumps:
  skills:
    plot: minor
    plot-dispatch: patch
-->
