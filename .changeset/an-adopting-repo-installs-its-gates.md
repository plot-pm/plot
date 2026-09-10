---
'plot': minor
---

`/plot-init` offers to install Plot's gates as `PreToolUse` hooks in the adopting repository's own `.claude/settings.json`. `hooks/hooks.json` is `${CLAUDE_PLUGIN_ROOT}`-relative and reaches only a plugin install, so a repository that vendors the skills or clones the repo had no gates and nothing said so. The new `plot-install-hooks.sh` reports `written`/`current`/`present`, writes nothing under `--check`, never overwrites a foreign hook, and reads the gate set from `hooks/hooks.json` rather than naming gates in its own body.

<!--
plan: docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md
bumps:
  skills:
    plot-init: minor
    plot: minor
-->
