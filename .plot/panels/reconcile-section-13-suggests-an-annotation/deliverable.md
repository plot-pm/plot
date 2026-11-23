# Juror: deliverable

Subject: docs/plans/2026-11-21-reconcile-section-13-suggests-an-annotation.md (Draft, issue #3586).

## Does the slice name something that ships

- The one slice `feature/reconcile-13-reads-open-annotation` (plan:60) names a shippable change: section 13 of `skills/plot/scripts/plot-reconcile-scan.sh` (loop at :1835-1872, fix hint at :1866) plus a contract test in `test/reconcile/`. The existing section 13 tests sit at `test/reconcile/scan.test.mjs:1712-1866`, so the test has a home.
- The slice scope is conditional: "and the unshipped-release case, if chosen". A worker cannot build "if chosen". The branch name already fixes option 1, so the slice assumes the answer to Open Question 1 while the plan leaves it open (plan:33, :51).
- The slice also names "the section's header comment". Two comments describe section 13: the index at `plot-reconcile-scan.sh:113-121` and the section comment at :1810-1834. The slice must name both.

## Does the Changelog match the slice

- No. The Changelog (plan:17) is a disjunction: "reads a defined annotation … or its fix hint stops naming an annotation". That line describes option 1 OR option 2. The slice builds only option 1. A release note must state the one behaviour that ships. Rewrite the Changelog once Q1 is answered.
- The Changelog says nothing about the unshipped-release suppression, which the Recommendation (plan:38) makes the main case. If Q3 says yes, the Changelog omits the larger half of the behaviour change.

## Evidence that settles or narrows the Open Questions

- Q2 (syntax) is settled: "any HTML comment" is wrong. `/plot-approve` writes `<!-- pr: #N, branch: X -->` on every approved member line (`packages/domain/src/rules/sprint-annotation.ts:44-48`, called from `packages/domain/src/transitions/sprint-member.ts:230`). The live sprint shows one at `docs/sprints/active/delivery-ui-polish.md:26`. With "any comment", every approved plan's item reads as kept open, and section 13 goes silent for the whole estate. The plan must choose a named field. A field inside the existing comment (`open: <reason>`) fits `annotateSprintItem`, which merges fields into the first `<!--` and keeps other fields.
- Q3 (unshipped release suppresses by itself) contradicts two estate readings the plan does not cite:
  - `/plot-deliver` ticks the box (`packages/domain/src/workflows/deliver.ts:248-251`, `tick: true`). An unchecked item over a Delivered plan exists only when a person un-ticks it or delivers outside the workflow. The plan does not name this. The design blesses a state the deliver workflow overwrites.
  - `plot-sprint-release.sh:70-80` reads an unchecked box over a delivered plan as `done`. `/plot-release` therefore already treats the item as finished, and no reader interprets "…, released" as a commitment. An auto-suppression adds a second, opposite reading of the same line.
- The plan's claim that section 17 / `plot-sprint-release.sh` "already answers whether the release shipped" (plan:27, :38) is false. `plot-sprint-release.sh` reports `release` verbatim and decides nothing (its header, lines 1-16). The tag check lives in the scan's own section 17 loop (`plot-reconcile-scan.sh:2240`, `git rev-parse refs/tags/$cand`). Section 17 skips Closed sprints (:2230), while section 13 walks all sprints including Closed ones (:1838). So constraint plan:45 ("section 17 reports that case") does not hold for a Closed sprint, and section 17 reports a sprint, never an item.
- Q4 (own counter) is settleable as "no": no file under `packages/` reads `stale_tally` (grep finds only the scan, `test/reconcile/scan.test.mjs` and `test/reconcile/deliverable-search.test.mjs`). A new counter changes the exact summary line asserted at `scan.test.mjs:298` and documented at `plot-reconcile-scan.sh:27` for no consumer.
- Q1 narrows with Q3 gone: option 1 with an explicit `open:` field only, or option 2. Both are small. Option 1 explicit-only is consistent with section 18's precedent (`waits:` annotation read by the scan, :183ff).

## Cost and honesty

- The cost is small: one loop, one hint, two comments, one test block, one changeset for `plot` (no `bumps:` beyond `plot`, the scan is under `skills/plot/`). The plan names no changeset. "Board impact: none" (plan:19) holds for the counter. It must also say that the `open:` field shares the line comment that the domain writes, so `sprint-annotation.ts` tests should prove an approve re-run keeps `open:`.
- The plan is honest that it defers the choice. It is not approvable with four open questions, because the slice's scope and the Changelog both depend on Q1 and Q3.

## Required amendments

1. Answer Q2 as a named field (`open: <reason>`), citing the `pr:/branch:` comment.
2. Drop or re-argue Q3 against `deliver.ts:248` and `plot-sprint-release.sh:79`; correct plan:27/:38/:45 about what section 17 and `plot-sprint-release.sh` know.
3. Answer Q4 as no new counter.
4. Rewrite the Changelog to the one behaviour that ships, and remove "if chosen" from the slice.

Position: amend
