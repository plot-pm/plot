# No controller restarts a stopped slice desk

> A claimed slice whose worker is `failed` or `ended` has no controller route to a new worker. `plot-dispatch.sh --restart <branch>` does it, and nothing a master agent may call reaches it.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2784
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A master agent restarts the worker of a claimed slice whose worker is `failed` or `ended` through a controller action, on the board and in a board-free bundle. `plot-fleetctl.sh --start` no longer leaves the slices that `--stop` stopped without a worker.

<!-- Board impact: a new action endpoint and its row state on the board's fleet section. No change to the plan format, template or docs/plans layout. Rebuild the board artifact if the endpoint is added. -->

## Motivation

Measured 2026-10-27 (issue #2784):

- `plot-fleetctl.sh --stop` at 15:06 sent SIGTERM to the worker of `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (exit 143). `--start 8` then started 7 free desks and did not restart this one.
- The pulse row read `worker: failed`, `startability: someone-is-on-it`, `group: waiting-on-you`. fleetd handed the slice to no free desk, and five free desks stayed idle for about 90 minutes.
- `plot-dispatch-command.mjs the-reaper-keeps-leftovers-that-no` ran a brief-only implement and restarted nothing.
- `plot-continue-command.mjs <branch> <answer>` refused `no-question`, because the desk holds no `PLOT-BLOCKED` marker.

`plot-dispatch.sh --restart <branch>` restarts the worker on the existing desk. No board endpoint and no board-free bundle calls it. *The Master Agent Uses The Controllers* in `CLAUDE.md` forbids calling the script directly, so a master agent that follows the rule has no route. The gap is the finding.

The same gap shows in `2026-10-09-no-controller-resumes-a-claimed-slice` (released): it covered a worker that ended on its time bound, and the supervisor now continues that slice. A worker that a person or `--stop` ended is not a `bound` ending, and no rule answers it.

## Design

### Approach

Two routes close the gap. The design chooses one, or both:

1. **A `restart` controller action**, on the board (`POST /api/restart`) and as a board-free bundle (`plot-restart-command.mjs <branch>`), in the shape of `dispatch` and `continue`. It calls a domain rule that accepts only a claimed slice whose worker reads `failed` or `ended` and whose desk exists, and then reaches `plot-dispatch.sh --restart` through an adapter. It refuses by name for every other state. The gate lists the action and its receipt.
2. **`plot-fleetctl.sh --start` restarts the workers that `--stop` stopped.** `--stop` keeps each desk and its claim, so `--start` has the facts to restart them.

Layering follows *The Layering Rule*: controller, domain rule, port, adapter, script. Scripts are reached from an adapter only.

### Open Questions

- [ ] Route 1, route 2, or both? Route 2 alone does not help a worker that died for another reason.
- [ ] Should fleetd restart a `failed` slice by itself? `ending-action.ts` has no row for an ending that `--stop` writes.
- [ ] Which endings count as restartable: `failed` and `ended` only, or also `finished` with unlanded work?

## Slices

### Restart controller

- `bug/a-stopped-slice-has-a-restart-controller` — domain rule, adapter, `POST /api/restart` and the board-free bundle

## Notes

- Overlap checked against `2026-08-27-a-stopped-worker-can-be-restarted` (Released) and `2026-10-09-no-controller-resumes-a-claimed-slice` (Released): both are delivered, and neither adds a controller action.
