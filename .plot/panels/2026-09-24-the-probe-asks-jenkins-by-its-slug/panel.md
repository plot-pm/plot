# Panel moderation — the-probe-asks-jenkins-by-its-slug

**Reconciliation: `unanimous amend` — estate, evidence, adoption.**

The defect is real and the direction is right. Three corrections, and one of them changes what the fix *is*.

## The fix was described wrongly, and the correction makes it smaller

The plan said the careful splitter already exists thirty lines below and the fix is to **hoist the computation**. Estate read it and found it produces `_ji` (scheme-stripped) and `_jen_job_raw` (everything after the first `/`) — **and no slug at all.** Hoisting it would move code that does not answer the question.

**The slug expression exists in the other file**, and the moderator verified it: `plot-host.sh:1228` is `slug="${instance%%/*}"`, used by all three `jen -I` calls there — `:1250`, `:1268`, `:1321`.

So the estate has the correct parse written down, the probe has neither half, and the fix is *hoist the scheme-strip, add one parameter expansion*.

## The Open Question is answered and it NARROWS the slice

The plan hedged: *"a second occurrence would widen this slice."* It does not occur. **`plot-board-probe.sh:316` is the estate's only caller passing an unsplit value.**

That strengthens the plan's argument rather than weakening it: the probe is failing to honour a contract stated in the very file that implements it correctly.

## A citation was wrong

The contract is at `plot-host.sh:1173-1174`, not `:702`, which is in `url_encode`'s region. Verified by the moderator. The contract itself is real and says exactly what the plan quotes.

## What the moderator notes about the remaining findings

Estate also names an **ordering hazard in the hoist** the plan does not mention, and evidence and adoption each ran their own scope. Those are recorded in their verdict files and the slice inherits them; none contradicts the corrections above, and none is disputed by another juror.

## The disposition

**Amend before building.** The defect, the failure direction and the *unknown*-not-*failed* argument all stand. What changes: the fix is a scheme-strip plus `${_ji%%/*}` rather than a hoist of something that already computes a slug, the Open Question is closed as *narrower*, and the citation is corrected.
