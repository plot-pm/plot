---
'plot': patch
---

The board package is published when a release candidate is cut, not on every
push to `main`.

The previous job ran on every push under the condition "a `@plot-pm/board`
changeset is pending". That condition describes repository state and holds from
the merge of a board pull request until the merge of the version pull request,
so pushes that touched no board code republished it unchanged. Measured
2026-08-26: 709 published prereleases against 7 stable releases, 27 of 31 in the
`0.8.0` series carrying unchanged board code, and six of fourteen prerelease
bases that never shipped a stable release at all — `0.4.0` holds 188 candidates
for a version that does not exist.

Publishing now runs on the `v*-rc.*` tag that `/plot-release rc` already writes
alongside a verification checklist. One publish per release candidate, and the
tag records who cut it. `npm i @plot-pm/board@rc` returns a build nominated for
verification.

A release candidate whose base never ships stable remains an expected outcome: a
minor changeset merged during verification moves the next stable elsewhere, and
the candidate has already served its purpose.

Also fixed: `changeset status` failures were reported as an empty release set.
The command exits 1 both when nothing is pending and when a changeset names a
package outside the workspace, so the release job now discriminates on the
message and fails on anything else. The previous fallback held board publishing
for three days while more than 200 runs reported success.
