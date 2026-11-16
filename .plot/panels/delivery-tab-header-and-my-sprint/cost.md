# Juror verdict: cost lens

Position: amend

## What I read and ran

Read the subject plan fully. Opened code: `packages/domain/src/rules/sprint-record.ts`, `skills/plot/templates/sprint.md`, `DeliveryFilters.tsx` (header), `packages/board/src/contract/schema.ts` (`FleetSprintSchema`), `rules/sprint-selection.ts`, `agent-rows/mine-filter.ts`, `delivery-view.ts`, plus greps for `This sprint`, `People`, `sprintRecordOf`. Skimmed sibling plan lines about scope, owner and header. I did not read the design spec or story docs in full, and I did not run any test.

## Findings

1. **misleads** (plan lines 20, 40, 87). The plan renames the **This sprint** chip to **My sprint**. `data-chip="This sprint"` is a selector in at least 4 browser test files (`sprint-switch`, `agents-tab`, `sprint-exempt`, `delivery-filters`), plus `chip-readings.test.ts`, `chip-row.test.ts` and `filtered-estate-totals.test.ts`. `DeliveryFilters.tsx:63-65` records that the `data-chip` value was deliberately kept for those files. The plan states the rename as a one-line change and costs none of it. Browser tests are the expensive tier (CLAUDE.md measured 42 of 43 starting a full board server). Name the file count, and say whether `data-chip` keeps its value.

2. **misleads** (plan lines 20, 40). The chip row already carries a sprint multi-select (`selectedSprints`, per-sprint chips, a `This sprint: <title>` label, `?sprint=` URL state) and a `Mine` / `Waiting on me` pair. The plan defines **My sprint** as "the reader's own Active sprints" and never says how it relates to `?sprint=` selection or to `Mine`. Two scope mechanisms feeding the same sections is an unpriced behaviour change for existing sections. Risk: You and Work items change what they show for a reader with the old toggle on.

3. **misleads** (plan line 43). The sprint card needs "ends Friday, 20 November". `FleetSprintSchema` (`schema.ts:4269`) carries `start`, `timebox` and `timeboxLabel`, but no `end`. `sprintRecordOf` parses `end`, so only the wire shape lacks it. The "Sprint owner" slice says only Owner is added to the payload. Another contract field is needed, with the schema and fixtures that follow it. Small, but it is not in the slice text.

4. **misleads** (plan lines 39, 79). "checked against `People`" is assigned to the parser in `packages/domain`, but `People` is read server-side (`server-info.ts:170`, `board.ts:2852`) and handed in. The domain parser has no access to it. The check belongs to the board or to a rule that takes the directory as a value. The plan does not say what happens on a mismatch: refuse the file, drop the Owner, or warn. A refusing parser would make an existing sprint file with a typo stop parsing.

5. **cosmetic** (plan lines 39, 79). Existing sprint files cost nothing today: `grep` finds no `Owner` in `docs/sprints` (32 files), and a sprint without Owner is defined as belonging to nobody's toggle. Consequence the plan does not state: until someone adds `Owner:` to the Active sprints, **My sprint** is disabled for everyone. Not a defect, but the plan should say who backfills.

6. **misleads** (plan lines 64, 41, 87, 52). The open question (reader not in `People`) is described as open, but the code already has `Reader`, `readerIsKnown` and `MineMode` strict/lenient arms (`mine-filter.ts:1`, `:101`). The reader-handle concept exists and treats `unknown` leniently for Mine. So the question is mostly answerable from existing precedent, and the plan does not cite it. Cost of leaving it open: it blocks only slice 4 (`delivery-my-sprint-scope`), because that slice contains the toggle's disabled rule. The "Done When" bullet (line 52) states the disabled condition as "reader owns no Active sprint", which is silent on the unknown reader, so the Done When is not testable until the question closes. Slices 1 to 3 do not depend on it. State that slice 4 depends on the answer, and prefer the existing `readerIsKnown` behaviour.

7. **cosmetic** (plan line 24, slices 1 to 4). The plan says rebuild the artifact "with each slice that changes the board". CLAUDE.md says a PR diff must carry no generated bundle (`check-no-bundle-diff.sh`), and `main` builds its own bundles. The instruction conflicts with that gate. The builder runs the rebuild only to test locally, not to commit it.

8. **cosmetic** (cost of the slice split). Four slices, three of which (cards, scope, and later plans 2 to 6) wait on `feature/delivery-section-header`. Five sibling plans wait on slice 1, and the release-progress plan also waits on slice 4. One slice thus gates the whole 6-plan set. This is flagged as a Writer's call, fine, but the plan does not cost the head-of-line blocking: every sibling PR stalls on one CI round trip of the first slice. Slice 1 touches every Delivery section at once, so it has the widest blast radius and no stated scope limit for browser tests.

9. **cosmetic** (plan line 42). One release card per distinct `Release:` value multiplies cards and the Approve button instances. Payload and render cost are small, but each card needs its own host read for approve state. The plan does not say whether those come from the existing index or add host calls. I found no host-call mention anywhere in the plan.

## Not found

No finding on payload size: Owner, end and counts are small strings and integers per sprint. Header counts and cards are domain-derived from data already in the payload, so the plan adds no host or API call as written (see 9 for the one gap).

## Summary

Verdict: amend.
Main costs the plan hides: the `This sprint` rename across 7+ test files, the unexplained overlap with the existing sprint selection and Mine chip, and the missing `end` field in the fleet schema.
The open reader-not-in-People question blocks only the scope slice, and existing `readerIsKnown` precedent mostly answers it.
