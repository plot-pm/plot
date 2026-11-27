# Panel: a-release-between-two-sprints-books-its-plans

Round 1, 2026-11-27. Subject: `docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md` on `origin/main` (Approved 2026-11-27, issue #3736; slice 1 open as PR #3741). Lenses: estate, testability, user. Commitment: `Position: proceed|amend|reject`. The gate committed all three files.

**Reconciliation:** unanimous `amend` (estate, testability, user). No juror rejects.

## What each juror looked at

- **Estate** read the plan against `release-finish.ts`, `release-tag.ts`, `deliver.ts` and the gates, and grepped plan files for arrows inside `v2.36.1..v2.37.0`.
- **Testability** asked which test proves each rule, and built the equality oracle from the 2.37.0 bookings.
- **User** read the plan as the operator who booked 11 plans by hand for 2.37.0.

All three checked the Motivation against main and the 2.37.0 tag, and found it true. None ran the slice's code.

## Where the three agree

1. **Slice 1 (PR #3741, the changeset arm) can proceed.** Slice 2, the tag-range arm, needs the changes below before it starts.
2. **A plan that did not ship can be booked.** The range arm books a plan when any one of its slices merged before the tag, so a plan whose last slice merged after the tag is booked into the earlier release. A plan may be booked only when every non-deferred slice merged at or before the tag, proved by a two-slice fixture.
3. **A wrong booking cannot be undone.** `plot-reject` moves Delivered to Approved and nothing reverses Released; a hand revert stops at `plot-state-gate.sh`. The plan's "a person can reject" bound does not exist. Either the plan adds an unbook route or it states that a booking is final and makes the scope strict enough to need none.

## Where they differ

- **Estate alone** finds that the rule exists: `releaseTag`/`releasePr` in `packages/domain/src/rules/release-tag.ts` answer which tag shipped a plan, with every-PR containment and sprint carriage (`carriedRelease`), and `plot-deliver.mjs --release` uses them at `deliver.ts:946-957`. The range arm must use that rule instead of a new walk.
- **Estate and testability** both find that a first-parent range walk misses slices merged into a `sprint/*` branch (#3636, #3460, #3386), whose merges sit under the sprint merge's second parent. Using `releaseTag` removes this; otherwise a sprint-branch fixture is needed.
- **Estate alone** finds that the arm reads `→ #N` anywhere in a plan file, so prose matches: this plan's own Motivation holds `→ #3709`, and `2026-10-23-plot-plan-meta-a-branch-heading.md:55` holds `→ #3712`, both in the 2.37.0 range. Arrows must be read from slice lines only.
- **Estate and testability** both find that `check-ancestry-decisions.sh:65` does not match `git log A..B` or `tag --contains`, so the plan's `evidence` marker is voluntary, not gated.
- **Testability alone** finds that the plan's negative tests pass today, before slice 2 exists. The oracle that catches a wrong arm is equality: the scope at `a55df0f41` must equal the 11 slugs booked by hand in `63a5b69a9..8843327f2`. It also asks for a real-repo test through each caller and a test that fails on any host call.
- **Estate alone** counts the callers: three `releaseUnbooked` readers plus the finish entry, not two. The plan must name each, keep the empty-`Release:` sprint fallback, and say what a failed range read answers.
- **User alone** asks for the finish's report: which plans it booked and from which source, which it skipped and why, and the board's `unbooked` item on the same reading, so "Board impact: none" no longer holds. It also corrects the Motivation: the finish already lists unbooked Delivered plans (`release-finish.ts:180-183`); the gap was the refusal.

## A shared blind spot

All three judge the scope by what a release shipped. None asks what the operator gains from slice 2 once slice 1 lands: in 2.37.0, 10 of 11 plans were named by changesets, and the eleventh, #3709, had no changeset at all. A changeset gate that refuses a slice PR with no changeset would have caught it at merge time, with no range reading, no ancestry and no unbook route. The plan should compare slice 2 with that gate before it builds slice 2.

## Changes for the author, in order

1. Book a plan only when every non-deferred slice is in the tag; read arrows from slice lines only.
2. Use `releaseTag`/`releasePr` instead of a new range walk, or state why not and add a sprint-branch fixture.
3. Make the equality at `a55df0f41` the test oracle; add real-repo tests through every caller and a no-host-call test.
4. Name all four callers, the empty-`Release:` fallback, and the answer to a failed read.
5. State that a booking is final, or add an unbook route; remove the "a person can reject" bound.
6. Specify the finish's report and the board's `unbooked` item.
7. Compare slice 2 with a gate that requires a changeset on every slice PR, and record the decision.
