---
"plot": patch
---

The controller gate no longer refuses a command that only *mentions* a controller-owned script's name in text no process executes (#2440): `git commit -m "plot-deliver.sh flipped only the Status block"`, the same message read from stdin via `git commit -F - <<EOF`, and the reason argument of `plot-state-receipt.sh --unowned-action deliver <slug> "plot-deliver.sh flipped …"` all used to be refused though the command runs no script at all. `withoutMessageSinks` blanks those three message-carrying sinks before `controllerInvocation` reads the command, the same way the existing single-quoted-heredoc strip already treats that body as data. The strip is sink-aware, not position-aware — a loop body, `sh -c`, `bash <script>` and the rest of the #935 invocation corpus still refuse unchanged, and a heredoc body holding a `$( )` or backtick substitution is never treated as data, because that substitution can still invoke the script it names.

<!--
plan: docs/plans/2026-10-24-controller-gate-fires-on-a-script.md
bumps:
  skills:
    plot: patch
-->
