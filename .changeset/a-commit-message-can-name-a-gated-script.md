---
"plot": patch
---

The controller gate no longer refuses a command that only *mentions* a controller-owned script's name in text no process executes (#2440): `git commit -m "plot-deliver.sh flipped only the Status block"` (also with `-am`, `git -C <dir>`, a `;` inside the quotes or a multi-line value), the same message read from stdin via `git commit -F - <<EOF`, and the reason argument of `plot-state-receipt.sh --unowned-action deliver <slug> "plot-deliver.sh flipped …"` all used to be refused though the command runs no script at all. `withoutMessageSinks` blanks those spans before `controllerInvocation` reads the command, using a quote- and heredoc-aware reading of the command line (`readShell`). It blanks only text the shell never runs: a value, reason or unquoted heredoc body that holds `$( )`, a backtick or `${ }` stays, a heredoc body is blanked only when the `git commit -F -` command itself opens it, and a line the reading cannot parse comes back unchanged. The single-quoted heredoc strip now uses the same reading, so a here-string (`<<<`) or a `<<` inside quotes no longer hides the lines after it, and no line is ever dropped. An unpinned `gh pr merge` inside a quoted `$( )` now refuses.

<!--
plan: docs/plans/2026-10-24-controller-gate-fires-on-a-script.md
bumps:
  skills:
    plot: patch
-->
