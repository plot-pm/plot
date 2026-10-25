---
'plot': patch
---

Adds `scripts/check-bash32-syntax.sh`, a CI gate that greps shipped shell for eight bash-4+ constructs (`${x^^}`, `${x,,}`, `declare -A`, `mapfile`, `readarray`, `|&`, `&>>`, `${x@Q}`) that `bash -n` cannot catch because they fail only at run time, not at parse time — the shape of the defect PR #2659 shipped past a green ubuntu-bash-5 CI run.

<!--
plan: docs/plans/2026-10-25-ci-does-not-run-shipped-shell.md
bumps:
  skills: {}
-->
