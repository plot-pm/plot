# Panel — a-scan-section-honours-offline

**Reconciled: `unanimous` — amend (gates, premise)**

Both jurors confirm the defect and the fix. Both amend on the plan's own
measurements rather than on its design, and the two findings compose into one
correction: **the plan understates the defect and overstates the cure.**

## The defect is real and neither juror disputes it

Section 6 calls `plot-host.sh pr-state` per delivered plan with no `PR_SOURCE`
test between the loop's `while` and the call. `--offline` sets `PR_SOURCE=off`,
section 2 honours it and prints `pr_source=off`, and the scan's header promises
*"no git-host network call"*. Section 6 makes one anyway.

**`gates` confirmed the strongest gate's machinery already exists.** Its brief
asked whether counting host calls against a stub needs something that is not
there; `scan.test.mjs:411` already builds exactly that, and the note-text gate
has a precedent at `:939` asserted the same way. The plan's anti-plumbing clause
is sound and the note gate cannot be satisfied by an empty section.

## The plan's estate measurement is wrong, and the correction strengthens it

The plan writes *"2 delivered plans at 1.76 s each"*. Re-derived here:

```
SKIP (docs):  the-skills-say-slices
SKIP (infra): the-supervisor-log-has-a-ceiling
delivered=2  reaching_pr_state=0
```

**Zero plans reach the call**, because `:1143` exempts `docs|infra` before it —
the same filter repaired yesterday in `f5d052af`. The plan cited a cost for a
call that never happens.

**The conclusion it was drawn to support holds more strongly than written.** The
defect is not merely invisible here; it is unreachable. So the amendment
replaces a wrong number with a stronger fact, and adds the consequence `premise`
draws from it: **the fix's own test cannot point at `docs/plans/` and must
synthesize a fixture**, because no real plan on this estate exercises the loop.

## The cure may not reach the symptom the plan is framed by

`premise` measured an offline scan here at **464 s with zero host calls**. The
plan attributes an offline scan's residual to a 0.117 s per-plan parse, which
over 292 files predicts ~34 s.

**An order of magnitude is unaccounted for**, and the plan opens with a pulse
timing out at 90 s. A reader would reasonably expect that budget to be met once
this lands. On this estate it will not be, and the plan does not know why.

That is out of scope for the fix and **in scope for the plan's framing**: the
Design should say that honouring the flag removes the host calls and does not,
by itself, make an offline scan fit a 90 s budget — because it is already known
not to, here.

## What the lenses had in common

**Both reasoned about section 6 and neither asked what the other sections cost.**
`premise` found the 464 s and named it unexplained; `gates` read six clauses of
one section. Between them they measured the part the plan names and left the
part the plan's own symptom depends on unmeasured.

**That is the shared blind spot and it is the more valuable finding**: the
report's repository timed out inside section 6 at 100 s, and this estate spends
464 s offline without entering it. Both are true, and they are not the same
problem. The plan fixes one and is titled for the other.

## The moderator's reading

**Unanimous, and the amendments are three, all factual:** replace the estate
measurement with `reaching_pr_state=0` and say why; state that the loop's test
needs a synthesized fixture; and scope the cure honestly against the 464 s
reading rather than against the 90 s budget.

**The fix itself needs no change.** Every gate survives, and the strongest one
has its machinery already.

**Nothing here moves the plan's phase.**
