---
'plot': patch
---

The Writer and Merger App identities are opt-in: with no `Writer app` or `Merger app` key in `## Plot Config`, a lifecycle push and a GitHub `pr-merge` run as the ambient identity and print one notice line on stderr. A declared key that is malformed or unreadable still refuses with exit 4.

<!--
bumps:
  skills:
    plot: patch
-->
