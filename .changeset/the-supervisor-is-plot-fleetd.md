---
'plot': minor
---

The supervisor process is now plot-fleetd, not plot-registryd — the bundle artifact, launchd label, systemd unit, docs and tick-log-line prefix all carry the new name. An installed unit under the old default label is migrated (bootout, then reinstalled under the new default) rather than left orphaned; a unit under an operator-chosen custom label is untouched. The process classifier recognizes both the old and new bundle-path suffixes indefinitely, since an unrelated installation keeps running the old-named bundle. `--status` now detects and reports a loaded unit whose bundle file no longer exists.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot-fleet: minor
-->
