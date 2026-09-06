# A stated wait is a parsed wait

> A plan said in bold that its slice waits for another plan. The machine could not see it, dispatched the slice as eligible, and a person withheld the brief by hand for a week. `waits:` is a parsed annotation; the prose was not one.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A dependency a plan states in prose but not in an annotation is reported.

<!-- Board impact: the board renders slice verdicts, so a slice that stops
     reading eligible stops being offered. This reports; it changes no verdict. -->

## Motivation

**Measured 2026-09-06.** `a-desk-is-adopted-and-swept` carries this in its second slice:

> **IT WAITS FOR [`a-desk-is-finished-with-once`](2026-09-05-a-desk-is-finished-with-once.md) (#705).**

**The heading carried no annotation.** `waits:` is parsed into `waves[].branches[].waits_on` and used by 6 plans; this slice used none, so `bug/the-reaper-reads-prunable` read as fully eligible and appeared in the supervisor's queue as `no-brief`. A person recognised the prose and withheld the brief by hand — the only thing that stopped it being dispatched.

**AND THE PREREQUISITE IS FURTHER AWAY THAN THE PROSE SUGGESTS.** #705 is an unmerged **idea** branch, so its plan is not on `origin/main` at all and `plot-plan-meta.sh` reports `phase: NONE`. The slice was waiting on a plan the estate cannot yet see.

**A wait a reader can see and a machine cannot is a rule.** CLAUDE.md's own test — *can you answer "did I complete this?" without doing the work?* — is answered **yes** by "state the dependency", and this plan is the case where somebody did state it and the machine dispatched anyway.

## What this is not

**Not a new annotation.** `waits:` exists, parses, and is used. What is missing is anything that notices when a plan means it and does not write it.

**Not a verdict change.** The scan reports; whether a stated-but-unannotated wait should block is the author's to fix by adding the annotation. A checker that inferred waits from prose would be guessing at English.

**Not a sweep.** One plan had the gap and it is fixed. The value is in catching the next one.

## Slices

### The scan reports a wait that only prose declares (Branch: bug/a-stated-wait-is-a-parsed-wait)

`plot-reconcile-scan.sh` reports a slice whose body names a dependency that its heading does not.

**IT MATCHES ON THE ESTATE'S OWN VOCABULARY, NOT ON ENGLISH.** A slice body that links another **plan file** or names a **PR number** while its branch line carries no `waits:` is the shape to report — both are things the scan can resolve, and both were present in the measured case. Prose like *"after the other one lands"* is not, and the check must not pretend otherwise.

**IT REPORTS AND GATES NOTHING.** A plan may legitimately mention another plan without waiting on it — this plan mentions three. The finding names the slice and the reference so an author can say *yes, that is a wait* or *no, it is context*, which is the same posture as `uncut_slices=` and the sprint-index section.

**IT BELONGS BELOW `== blocking sections end ==`.** An unannotated wait is a legibility gap, not a broken pointer, and an advisory finding that can stop a delivery is a gate nobody agreed to.

**Done when** the scan reports a slice whose body references a plan or PR while its branch line carries no `waits:`, names both, counts it in the machine-countable footer, gates nothing, and is silent on the plan that now carries the annotation.

## Notes

### Why this is worth a check rather than a habit — 2026-09-06

The author who wrote the prose knew about `waits:` — the same plan uses `deferred:` and `moved:` correctly elsewhere. Knowing the annotation exists is not what was missing; **noticing that this sentence was one** is.

That is the shape of every finding this scan already carries: not ignorance, but a fact stated in one place and needed in another.
