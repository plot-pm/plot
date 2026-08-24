---
"@plot-pm/board": patch
---

A row no longer cites a pull request that was closed without merging. A closed
PR is an ended artifact, not an ended branch: work on the branch continues
toward another PR, and the wave lives on in the branch.

`prOutranks` already preferred an open PR over a closed one, but it ranks the
PRs a head carries and never asks whether the winner is worth showing. Measured
2026-08-24: ten branches carried a single closed PR, and one rendered *worker
finished — review it* over a PR closed as superseded an hour earlier — the board
asking a reader to review something withdrawn.

The row now shows the branch and its git state, and links a PR only where one is
live. No verdict changes: `classify` already receives the open-only record, so
the wave arithmetic is untouched.
