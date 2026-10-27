---
'plot': minor
---

A stopped slice now has a restart controller. `POST /api/restart {"branch"}` and `board/plot-restart-command.mjs <branch>` start a new agent on a claimed slice whose worker is dead, under the desk's `.plot-worker.continue.lock`, and supersede `.plot-worker.ending.json` so a restarted worker killed without an ending reads as killed. `restartWorker` refuses an unanswered pull-request question (`pr-unanswerable`), a live loop (`loop-alive`) and an unattended caller (`unattended`). The row of a claimed slice with a dead worker offers Restart, decided by the domain's `restartOffered`. `plot-dispatch.sh --restart` becomes a launcher for the controller and `handover_refusal` is deleted. The controller gate refuses `--restart` with no `restart` receipt. Closes #2784, where `plot-fleetctl.sh --stop` left a slice parked for about 90 minutes.

<!--
plan: docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md
bumps:
  skills:
    plot-dispatch: minor
    plot: minor
-->
