---
'plot': patch
---

The `plot-fleetd` systemd unit now quotes `ExecStart` and `Environment=PLOT_REPO_ROOT`, and `plot-fleetctl.sh --start` doubles `%` in every value it fills on systemd, so a path with a space or a `%` no longer splits or expands. `--start` refuses a harness shadow only when the same-named entry in node's directory is a regular executable file, so a directory named `claude` no longer refuses it. New tests cover the fixed-list dedupe of node's directory (deleting its `sed` expression now fails one), the strict `Environment="PATH=..."` quoting and the quoted-and-doubled systemd fill; the duplicate absolute-path test is replaced. #1487 L3 stays open: node's directory still precedes `/usr/local/bin` and `/opt/homebrew/bin` for every binary it holds, `git` and `gh` included, and no symlink directory is built. A Homebrew `node@24` pin refuses `--start` when `/opt/homebrew/bin/claude` exists beside `~/.local/bin/claude`. Closes #1590, tracked under #1846.

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
bumps:
  skills:
    plot: patch
-->
