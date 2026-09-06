# A stated wait is a parsed wait

> A plan said in bold that its slice waits for another plan. The machine could not see it, dispatched the slice as eligible, and a person withheld the brief by hand for a week. `waits:` is a parsed annotation; the prose was not one.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 1
- **Started:** 2026-09-06, Jan Wloka, `bug/a-stated-wait-is-a-parsed-wait`

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

### The scan reports a wait that only prose declares (Branch: bug/a-stated-wait-is-a-parsed-wait, PR: #751)

`plot-reconcile-scan.sh` reports a slice whose body names a dependency that its heading does not.

**THE FIRST RULE WAS MEASURED AND IT IS UNUSABLE.** *A slice body that links a plan file or names a PR number while its branch line carries no `waits:`* was the drafted shape. Run over the estate 2026-09-06: **391 of 477 slices — 82% — would report.** A finding that fires on four slices in five is one a reader learns to skip, which is the bar this repo already sets for a new scan section.

**THE ESTATE'S VOCABULARY IS NARROWER THAN A LINK.** Plans cite each other constantly as context; this one cites three. What distinguishes a wait is the **claim**, not the reference. Measured over the same 477:

| phrase | slices |
|---|---|
| `waits for` / `waits on` | **13** |
| `depends on` | 16 |
| `after the …` / `after #…` | 13 |
| `lands first` / `must land` | 1 |

**AND EVEN THE 13 ARE MOSTLY NOT WAITS.** Read individually: a `--stop` that *waits for each* agent to exit, a design doc *about* wave waiting, a monitor that *waits on* a finding. **Two looked like real dependency claims and both are on Released plans** — the waits resolved by shipping.

**SO THERE IS CURRENTLY NOT ONE LIVE UNANNOTATED WAIT ON THE ESTATE.** 40 slices sit on Draft or Approved plans, and every one of them either carries `waits:` or states no dependency. The single real case is the one this plan was written from, and its annotation was added on 2026-09-06.

**IT REPORTS AND GATES NOTHING.** A plan may legitimately mention another plan without waiting on it — this plan mentions three. The finding names the slice and the reference so an author can say *yes, that is a wait* or *no, it is context*, which is the same posture as `uncut_slices=` and the sprint-index section.

**IT BELONGS BELOW `== blocking sections end ==`.** An unannotated wait is a legibility gap, not a broken pointer, and an advisory finding that can stop a delivery is a gate nobody agreed to.

**SO THE CHECK MATCHES A CLAIM AND ACCEPTS ITS FALSE POSITIVES.** `waits for` / `waits on` in a slice body with no `waits:` on its branch line — 13 hits over the whole estate, 0 over the 40 live slices. That is a section which is silent today and speaks when somebody writes the sentence this plan was born from. **The 13 are the honest cost**, and they are historical: a reader meets them once when the section ships, not every run.

**Done when** the scan reports a live slice whose body claims a wait while its branch line carries none, names the slice and the sentence, counts it in the machine-countable footer, gates nothing, and reports **zero** findings on today's estate.

## Notes

### Why this is worth a check rather than a habit — 2026-09-06

The author who wrote the prose knew about `waits:` — the same plan uses `deferred:` and `moved:` correctly elsewhere. Knowing the annotation exists is not what was missing; **noticing that this sentence was one** is.

That is the shape of every finding this scan already carries: not ignorance, but a fact stated in one place and needed in another.

### Round 1 — 2026-09-06

**The drafted rule would have reported 82% of the estate.** *A slice referencing a plan file or a PR number without `waits:`* fires on **391 of 477 slices** — plans cite each other as context constantly, and a link is not a claim.

**Narrowing to the claim brings it to 13**, and reading those 13 individually leaves **none that is both real and live**: a `--stop` waiting for each agent, a design doc about waves waiting, a monitor waiting on a finding. Two read as genuine dependencies and **both are on Released plans**, where shipping resolved them.

**Across the 40 slices on Draft or Approved plans there is not one unannotated wait.** The only real case is the one that produced this plan, annotated the same day.

**That is an argument for a smaller check, not against having one.** A section silent on today's estate and loud the next time somebody writes *"IT WAITS FOR"* is exactly what this defect needs — it cost a person catching prose by eye, and the next one may not be read. What the round removed is the version that would have buried that signal under 391 lines of context citations.
