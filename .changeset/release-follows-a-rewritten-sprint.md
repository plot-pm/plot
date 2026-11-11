---
'@plot-pm/board': patch
---

`plot-deliver.mjs --release` and the reconcile scan name the release of a PR merged into a sprint branch that was rewritten before it merged. Where no tag contains the PR's own merge commit, the release chain follows the sprint branch to its merge on the default branch, and accepts the host's merge subject for the PR in that merge as proof when ancestry answers no.
