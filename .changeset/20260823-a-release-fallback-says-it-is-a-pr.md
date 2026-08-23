---
'@plot-pm/board': patch
---

board: a release row's fallback number says it is a PR

A release row names the version it is cutting — `2.7.0` — read from
`package.json` on the release branch. Where that version cannot be read, the row
falls back to the PR number, and the number sat bare in the name slot: `300`,
where a version usually is. A bare `300` reads like a version — a truncated
`3.0.0`, a major nobody typed — and `changeset-release/main` is the one row a
person reaches for at the end of a sprint, so it is the last row that should ever
be decoded.

The fallback now carries a `#`: `#300`, the universal mark for a PR reference, so
it cannot be mistaken for the version the slot otherwise holds. The version case
stays unprefixed, because it IS a version, not a reference to one — the two are
distinguishable at a glance, which is the point. This closes the plan's last
release test: *falls back to the PR number and says so, rather than showing a
number that reads like a version.*

The rest of that plan's release work — reading the version through a contract
field, moving the PR and branch into the artifact-link slot, keeping the status
column free of anchors — had already landed via the `version` field
(`a wave is a kind`), which reads the version from `package.json` rather than
from the PR title the plan first named. `package.json` on a `changeset-release/*`
branch is written by changesets itself, so it is a stronger source than the PR
title convention: the plan's premise that `package.json` holds only the current
version was measured wrong (it holds the next one on the release branch). This
branch keeps that decision and adds only the fallback signal it left open.
