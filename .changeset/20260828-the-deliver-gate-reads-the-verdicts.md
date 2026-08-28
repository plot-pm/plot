---
'@plot-pm/board': patch
---

The Deliver gate reads the wave verdicts the pulse carries, and refuses to answer
at all from an incomplete scan — so a finished plan stops being told its branches
have not merged.

**Why this exists**: `allWavesMerged` opened with a lookup into `pulse.plans` and
returned `false` when it missed. `false` means *not merged*, so a scan that timed
out before reaching a plan produced a refusal naming that plan's branches.
Measured 2026-08-27 on a plan whose two PRs had merged the day before (#446,
#454): the payload carried 52 waves — both of that plan's among them, both
`complete` — and zero plans, because the scan had not finished. The operator went
looking for an unmerged branch that did not exist.

**Absent is not false**, which is the rule Plot applies everywhere else:
`plot-host.sh` reports `checks:"unknown"` rather than red, and `--next` exits 1
for *nothing to start*. The two states conflated here need opposite responses —
*your branches have not landed* means go finish the work, *the scan did not
finish* means wait and retry — so the function now answers three ways (`merged`,
`not-merged`, `unknown`) and takes the scan's completeness beside the pulse. It
also reads each wave's own `verdict` rather than re-deriving completeness from
the branch states beneath it, removing a second implementation of one question.

Fixed in `allWavesMerged` rather than in the route because it has **two** callers
and an operator meets both symptoms at once: the Deliver gate returns a fifth
verdict (`scan-incomplete`) whose message names the SCAN, and `planStatus` stops
rendering an unreached plan's card as `in-progress`.
