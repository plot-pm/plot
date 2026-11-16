# Estate juror verdict

Position: amend

Read: the subject plan in full; the header, changelog and slice lines of the five sibling delivery plans; grep of the code (sprint-record.ts, sprint.md template, DeliveryFilters.tsx, DeliveryRows.tsx, server-info.ts). I did not read a-deferred-slice-keeps-its-branch.md or red-hold-reads-the-pr-base.md beyond a grep; they concern reaping and the red hold and show no overlap. I did not read the full design spec.

## Findings

1. misleads: the plan's Motivation links `../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md`. `git ls-files` finds no such path. `docs/stories/` holds only archived, nothing-changed-nothing-runs and the-master-agent-holds-the-fleet. The Status block and all five siblings name this story, so the link is dead and the story file is not on this branch.

2. Notes claim confirmed, no blocks: the deliverable search finds nothing built. `sprint-record.ts` has no Owner field (only `Release:` at line 75). `skills/plot/templates/sprint.md` has no Owner. The only "This sprint" code is the existing chip in `DeliveryFilters.tsx` and `chip-row.ts`. No section-header, fleet-card, release-card or to-do component exists under `packages/board/src/app`. The plan's building scope is genuinely new.

3. No sibling claims the same slice. All five siblings (you-blocks-or-feeds, work-items-show-gates, release-progress-per-plan, machine-tickets-footer, fleet-rows-per-agent) wait on `feature/delivery-section-header` (this plan's first slice). Release-progress-per-plan waits on `feature/delivery-my-sprint-scope` (this plan's fourth slice). The slice branch names are unique across plans.

4. misleads, boundary overlap: the subject's fleet card ("shown read-only, linking down to the Fleet section header") and the fleet-rows plan's Fleet header with the same switches ("on the header line"). The two plans claim different surfaces, one the tab-header card and one the section header, but both render the fleet switches. The subject does not say that the card reuses the same switch state or `FleetControls.tsx` as the section header. A builder could implement the switches twice. The subject's fleet-card slice should name the reuse of `FleetControls.tsx`.

5. misleads, boundary overlap: the subject's "Sprint card ... progress per MoSCoW tier" and "release card ... five-segment bar" against release-progress-per-plan's "one card per team member ... slice progress" and slice strip. Both need a slice-state classification (delivered, in flight, to do). The subject does not say which plan owns the shared domain fact. Neither plan declares it.

5b. misleads: the subject applies the "My sprint" scope to You and Work items. Siblings you-blocks-or-feeds and work-items-show-gates rework those same sections and wait only on the section-header slice. They do not wait on `delivery-my-sprint-scope`. The scope's integration with the reworked rows is therefore unowned. The order in which the scope slice and those siblings land decides which one rewrites the other's rows.

6. cosmetic: the plan says the reader is matched against `People` handles. `server-info.ts:170-179` reads `People` through `parsePersonDirectory`, so a directory already exists to reuse. The plan's open question (the reader not in `People`) is real and unanswered, but the mechanism exists.

7. cosmetic: the plan says "The button in `DeliveryFilters.tsx` is renamed". The code comments (lines 63-65) say four browser test files select `[data-chip="This sprint"]` and the `data-chip` value is deliberately kept stable. The plan does not mention that these tests or the `dataChip` constant need a decision when the label changes to "My sprint".

8. cosmetic: the `Release:` field is single-valued per sprint (`sprint-record.ts:75`). The plan's "one card per target release" works from it. No finding beyond that; the plan is consistent with the parser.
