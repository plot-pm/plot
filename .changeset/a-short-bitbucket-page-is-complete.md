---
'plot': patch
---

A Bitbucket PR listing page shorter than its page length now counts as complete, so the board's PR note no longer reads "possibly truncated" on every refresh. `plot-host.sh pr-list` reads the page length for the `bb` version that answered: 50 for `bb` 1.9.0, measured on `quatico/quaweb-website`. A page of 50 rows, or any page from an unmeasured `bb` version, is still reported as possibly truncated. The new domain rule `pagePossiblyTruncated` and the shell copy are compared by a corpus test. Fixes #1137.

<!--
bumps:
  skills:
    plot: patch
-->
