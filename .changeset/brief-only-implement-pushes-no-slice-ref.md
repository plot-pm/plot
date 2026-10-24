---
'@plot-pm/board': patch
---

A `--brief-only` implement run can no longer push the slice branch it briefs: the new `brief-push` gate refuses the `git push` that would leave a claim ref the queue reads as held.

<!--
bumps:
  skills:
    plot-implement: patch
-->
