---
'plot': patch
---

Fixed three test-hygiene findings in the free-wait-bound desk suite (#1792): the dead-pid fixture now uses `999995`, inside the file's own `999996`–`999999` convention; the "clean desk drops" test now asserts the `.plot-worker.ending.json` fixture it writes rather than leaving it unchecked; and the PLOT-BLOCKED-marker test is renamed to say what it proves — `bashCleanliness` applies one exclusion set to every untracked path, with no special case for that marker's name.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot: patch
-->
