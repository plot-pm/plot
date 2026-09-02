---
'plot': minor
---

`plot-dispatch.sh` refuses a branch whose `waits:` prerequisite has not merged, and names it. The constraint was prose in a brief until now, and it had cost two workers: on 2026-09-02 `feature/the-domain-forgets-the-vendor-list` was dispatched onto an unmerged prerequisite, hit its own gate, and wrote a `PLOT-BLOCKED` marker holding nothing but its claim commit. The dispatcher gates on the plan's phase, and the plan was Approved, so the slice read as eligible.

The prerequisite is asked of PULL REQUESTS, never of the refs. `plot-release-refs.sh` deletes the remote refs of a delivered plan's merged branches, so a prerequisite that succeeded and was then reaped has no ref — a refs-reading gate would hold its dependent forever because its dependency succeeded. `NONE` and silence stay apart: a host that answered and never saw a PR is `blocked`, a typo that resolves by editing the plan; a host that could not be asked holds the branch at `waiting`.

`--allow-waiting` is the named escape, and it ADDS a candidate rather than relaxing a test. The scan reports a waiting branch as `waiting`, so `--next` and `--list-eligible` both withhold it and no test in the dispatcher ever sees it; the preflight supplies the branch it freed, taken last so an early start never displaces a branch that was ready.

`isClaimable` gains the annotation as a third fact, tested separately from `state` because the two disagree exactly here: a caller holding the plan's annotation but deriving `state` from git alone reads `open` over a live prerequisite.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
