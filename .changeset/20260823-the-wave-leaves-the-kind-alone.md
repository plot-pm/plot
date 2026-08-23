---
'@plot-pm/board': patch
---

board: lock the wave out of the kind's track

The plan's defect #3 was a wave name (`Shaped`, `Inverted`) rendered beside the
kind slot on `PR`/`BRANCH`/`AGENT` rows — the wave joined the kind rather than
moving beside the branch name. The wave-as-kind work and #339 (a wave renders as
exactly one row in exactly one section) had already removed it: every named-wave
branch groups under one `WaveRow` whose subject is the wave, so no branch row
wears a wave badge and nothing lands in the kind's track.

Adds a served-mock browser test that asserts the negative directly — no
`data-wave` in any kind cell, none on a plan/pr/agent/build row, and each named
wave rendered as exactly one `WaveRow` head — so a change that reintroduces a
branch-row wave badge is caught. Verified against the pre-#339 behaviour by
reinstating the `length > 1` wave-fold threshold: the suite goes red, then green
once restored. No runtime behaviour changes.
