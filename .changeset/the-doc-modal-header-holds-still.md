---
'@plot-pm/board': patch
---

The plan and story modal keeps its header in place while the document loads: the body is 70vh in the loading, error and loaded states, where it grew from 30vh to 70vh and moved the vertically centred header up, so a click on *Open in new tab* during that change opened no tab.

<!--
bumps:
  skills: {}
-->
