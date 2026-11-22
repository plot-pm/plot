# Juror: estate

Reading position: does this already exist? The defect exists as the plan describes it (`plot-reconcile-scan.sh:1847-1868`, with the hint at `:1866` and no read after the slug). The estate already answers most of the design, and part of that answer contradicts the recommendation.

## Contradictions

1. **The estate already settled what an unchecked box over a Delivered plan means: `done`.** `plot-sprint-release.sh:74-80` and `packages/domain/src/entities/sprint.ts:204-206` (`scoreItem`) call it bookkeeping lag, "not a claim in dispute". The release gate already counts the issue's `remove-selectors` item as finished. The plan's premise, "the item may be correctly open", gives an unchecked box a second meaning that the release rule does not hold. The plan does not mention this.
2. **`/plot-sprint close` ticks the item anyway.** Step 2a (`skills/plot-sprint/SKILL.md:542-557`) ticks every unchecked item whose plan is delivered or released and writes `<!-- reconciled: <phase> -->`. It reads no `open:` annotation. Option 1 would therefore keep an item open in the scan until close, and close would then tick it. The plan does not mention close.
3. **Sprint items already carry an annotation format, with one writer.** `packages/domain/src/rules/sprint-annotation.ts:41-70` (`annotateSprintItem`, written by `/plot-approve`) keeps ONE comment per line and splices `pr: #N,` into the first `<!--` (`:59`). The format is documented as a field table at `skills/plot-sprint/SKILL.md:276-286`. If a person writes `<!-- open: x -->`, the next approve turns it into `<!-- pr: #N, open: x -->`. So `open:` must be a field read inside the comment, and the field table needs a row for it. The plan treats the syntax as new.
4. **"Section 17 (`plot-sprint-release.sh`) already answers whether the release shipped" is wrong.** `plot-sprint-release.sh:1-8` reports the `Release:` field and decides nothing. The tag lookup is section 17's own loop (`scan:2219-2240`). Section 13 prints before 17, so the release case needs that lookup run a second time or moved into a shared function. The plan says the answer can be reused as it stands.
5. **"Board impact: none; the board reads neither" leaves out a second rule.** `packages/domain/src/workflows/reconcile.ts:125-130,328-334` holds `staleTally` and a `sprint-tally-stale` finding. `packages/board/src/server/entry/reconcile.ts:170` decodes the field. No shell producer sends `staleTally`: a grep of `skills/` finds none outside the bundles. The plan should name this duplicate and either update it or state that it is dead. Changing the shell rule alone widens an undeclared drift (CLAUDE.md, *A Shell Script Asks The Domain*).
6. "Related: #3489" comes from the consumer's issue text. In this repository #3489 is `approve-and-deliver-run-without-a-board` (`docs/sprints/2026-W47-bug-fixes-2-35-0.md:34`) and has nothing to do with this plan. Delete the reference or say that it is the consumer's number.

## Open Questions the evidence settles

- **OQ2 (syntax): "any HTML comment" is ruled out.** 165 member lines in `docs/sprints/` carry `<!-- pr: … -->`. Six unchecked lines in the active sibling sprint `delivery-ui-polish` (`docs/sprints/2026-W47-delivery-ui-polish.md:24-28,37`) also do. Under "any comment", each of these would go quiet the moment its plan is delivered. Only a fixed `open: <reason>` field inside the line's comment works, for the reason in point 3.
- **OQ3 (an unshipped `Release:` suppresses the finding by itself): no.** `delivery-ui-polish` declares `Release: 2.36.0`, which is not yet tagged. Suppression would silence the whole bookkeeping-lag population of every sprint that names a release, and that population is the one section 13 exists for. It would also contradict `scoreItem`'s `done`.
- **OQ1 (option 1 or option 2): the evidence favours option 2.** The estate's rule is to tick the box, and close does exactly that. Option 1 is coherent only if three more readers learn the same field: close step 2a, the `SKILL.md:276` field table, and (if the field is kept) the domain `sprintFindings`. Option 1 with that wider scope is defensible. Option 1 as sliced is not.
- **OQ4 (own footer counter): measurable cost.** `test/reconcile/scan.test.mjs:298` asserts the full summary line as a literal, and `skills/plot-reconcile/SKILL.md` documents each counter. A counter that no consumer reads should not be added. The plan names no consumer.

## Slice and Changelog

The slice builds option 1. The Changelog line still says "reads … or its fix hint stops naming an annotation". It must name one outcome. The `builds:` marker is fine. The slice also leaves out the fixture tests that exist at `scan.test.mjs:1805-1866`, which the change has to extend.

## Cost and honesty

Option 2 is a one-line change to the hint plus one test. Option 1 done correctly touches the scan, close step 2a, the annotation field table, possibly `reconcile.ts`, and tests. That is about four files, while the plan presents it as one section. The plan states no cost, and the recommendation looks cheaper than it is.

Fix: pick option 2, or widen option 1 to cover close and the field table. Settle OQ2 and OQ3 as above, make the Changelog name one outcome, and correct points 4 to 6.

Position: amend
