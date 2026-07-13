---
"plot": patch
---

Fix `plot-config.sh` to tolerate real-world `## Plot Config` values written as
backtick-quoted markdown with trailing prose (e.g. `` **Plan directory:** `docs/plans/` (note) ``),
and multi-value lists whose items are backticked and annotated (e.g. branch
prefixes) — without truncating the list to its first backtick span. Backticks
and parenthetical prose are stripped from the extracted value.

<!--
bumps:
  skills:
    plot: patch
-->
