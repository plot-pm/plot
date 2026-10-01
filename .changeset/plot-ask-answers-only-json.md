---
'plot': patch
---

`plot-ask.mjs` prints only its JSON answer on stdout again. With `Agent settings` configured it announced the resolved settings file on stdout before the answer, so `plot-deliver.sh` and every other caller that parses the answer read a deliverable plan as a refusal; the announcement now goes to stderr.

<!--
bumps:
  skills:
    plot: patch
-->
