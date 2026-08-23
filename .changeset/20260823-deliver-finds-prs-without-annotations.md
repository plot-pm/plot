---
'plot-deliver': minor
---

plot-deliver: verify by matching merged PR heads to branch names where a plan carries no `→ #N` annotation

`/plot-deliver` verified PRs only through the `→ #N` annotations in a plan's
`## Branches` section — written by the implementing worker, and, measured
2026-08-23, absent in most plans (12 of 16 in the active sprint carried zero).
So the delivery check refused on exactly the plans it exists to move, and
clearing them by hand cost a morning of back-filling 21 annotations first.

`plot-impl-status.sh` now reads the Branches section per BRANCH rather than per
annotation. A line carrying `→ #N` resolves by that number as before (and a
cross-repo `→ owner/repo#N` still routes to its repo — a form head-matching
could never reach). A line WITHOUT one falls back to matching the branch NAME
against the heads of merged PRs, fetched once through `plot-host.sh pr-list
--state merged`. This is the same derivation `plot-reconcile-scan.sh` already
applies in section 2: *the missing annotation and the missing delivery share a
cause, so an annotation-dependent check is blind to exactly the plans it exists
to catch.*

Decided and enforced:

- **The gate is not weakened.** A branch with no merged PR head and no
  annotation resolves nothing — never a fabricated MERGED — so a plan with an
  unmerged branch still refuses and the caller names it. Finding an
  un-annotated PR is a convenience; deciding a plan is deliverable is the same
  check.
- **Annotations, where present, win.** Head-matching is a fallback for the
  un-annotated line, never an override of an annotated one.
- **The host is asked through `plot-host.sh` only** — the merged-PR list and
  the per-PR state both route through the adapter, so no direct `gh`/`bb` call
  enters the delivery path.
- **The merged-PR list is fetched once per plan**, at top level (not lazily
  inside a `$(...)` subshell, which would refetch per branch), and only when
  some branch is un-annotated — an annotated-only plan pays nothing.

<!--
bumps:
  skills:
    plot-deliver: minor
-->
