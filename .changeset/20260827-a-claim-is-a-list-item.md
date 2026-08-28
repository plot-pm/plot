---
'plot': minor
---

<!--
bumps:
  skills:
    plot: minor
-->

A branch is claimed by the plan that LISTS it, not by every plan that mentions
it.

`plot-plan-meta.sh` matched a backticked branch name anywhere on a line under
`## Branches`, so a plan citing another plan's branch claimed it. Measured on
the board 2026-08-23: two branches rendered twice, in two sections, wearing
`claimed twice`. Both second claims were dependency citations — a plan
explaining why its wave is ordered where it is, which is exactly what a
`## Branches` section should say:

> **Depends on `approval-hands-the-work-to-agents` wave 1**
> (`feature/the-registry-knows-which-agents-live`), and the dependency is not
> tidiness.

Nothing was lost that time: both cited branches had already merged. But
`/plot-dispatch` fans out what the parser reports, so the same shape on an
unmerged branch starts a worker on a branch the plan does not own.

The matcher is now anchored to the start of a list item:

    ^[ \t]*-[ \t]+`(PREFIXES)/[^`]+`

A branch named mid-sentence, in a blockquote, in an HTML comment, or on a
wrapped continuation line is read as the citation it is. The `## Waves`
spelling was never affected — there the branch comes from the heading.

The rewording that repaired the two plans was a rule an author must remember,
in the one section where writing branch names is the entire point, and it had
already been forgotten twice. Gates over rules: the parser is now unable to
read a citation as a claim.

Licensed by a measurement rather than a preference. Swept across `docs/plans/`
on 2026-08-27: 259 lines under `## Branches` carry a backticked branch name and
all 259 are anchored list items, so the anchor drops no real claim; the estate
parses to 318 branches before and after. The contract test re-runs that sweep
**differentially** instead of pinning a total — the plan was written against
248 claims, main carried 200 four days later, and a hardcoded number would fail
a correct parser as the estate moves.
