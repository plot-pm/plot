---
'@plot-pm/board': patch
---

board: the section rules become an executable test

The eighteen section rules were measured against the live payload and written
down; nothing re-ran them. This pins them as tests, asserting today's behaviour —
twelve rules that hold and six that do not, each failing one carrying its measured
number so that fixing it BREAKS the test and forces a deliberate update.

Also asserts `classify` is total over the state cross-product and stable across
repeated evaluation.
