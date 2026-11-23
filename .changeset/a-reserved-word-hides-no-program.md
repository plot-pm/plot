---
'plot': patch
---

The controller gate, the merge-pin check and the CI-suite check read the program after a shell reserved word (`do`, `then`, `else`, `elif`, `if`, `while`, `until`, `!`, `{`, `(`, `time`), so `for i in 1; do curl -X POST …/api/release; done` and `if true; then gh pr merge 12; fi` stop passing. This also closes the HTTP form of #3165, `while X=ps curl -X POST …/api/release`. The controller gate passes a read after a reserved word, such as `if [ -f skills/plot/scripts/plot-deliver.sh ]; then echo yes; fi`.

<!--
plan: docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md
-->
