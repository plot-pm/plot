# Estate juror verdict, round 2

Position: amend

Read: the plan, the five sibling delivery plans' slices and waits, the round-1 estate verdict and panel, the design spec by grep. Ran (read-only): `git grep`/`grep`/`sed` over `packages/board/src`, `packages/domain/src`, `packages/*/test`, `skills/plot/templates/sprint.md` and `docs/sprints`. Ran no test and no board.

## Already in the estate, and the plan does not say so

1. **"Sprint owner" is an existing term with another meaning.** `packages/domain/src/rules/issue-source.ts:116` declares `export type SprintOwner = { owns: 'plot' } | { owns: 'external'; scheme }` and `:142` `sprintOwner(declaredSprintOwner, declaredTracker)`, fed by the `Sprint owner` config key (`skills/plot-board-setup/SKILL.md:329`) and called at `packages/board/src/server/entry/sprint-release-gate.ts:343`. It answers "who keeps this repo's sprints, Plot or a tracker". The plan's slice `feature/sprint-owner-field` and its "Sprint owner" prose reuse the word for a per-sprint person handle. The Notes line "Deliverable search for 'sprint Owner field' ... found no artifact of that name" missed it. A builder who writes `SprintOwner` collides at compile time; a reader confuses the two.
2. **The Delivery tab already shows one sprint line per Active sprint.** `packages/board/src/app/components/DeliveryFilters.tsx:183-200` (`data-sprint-report`) prints title, "target <release>", the timebox label and the item counts from `FleetSprint`. The sprint card covers the same facts, and no slice says it replaces this line. Without that, the tab shows the sprint twice.
3. **The Delivery tab already shows a release status line built from slice states.** `packages/board/src/app/lib/agent-rows/delivery-view.ts:411-423` computes `` `${slicesDelivered} of ${slicesTotal} slices delivered · ${held} held at gates · ${blocked} blocked` `` per target release, rendered at `AgentList.tsx:1389-1391` (`data-release-line`). It is a three-state slice classification computed in app code, not the domain, and its "blocked" is You › Unblock (`:416`), where the plan's five-state "blocked" is You › Blocks delivery. The plan's slice-states slice is the domain version of this line, and the release card restates it. Neither slice names this line or removes it, so two release summaries with two meanings of "blocked" would ship.
4. **The section summary half exists.** `SectionView` (`delivery-view.ts:159-168`) already carries `icon`, `label`, `groups` with per-group `count`, and the heading renders icon, label and count at `AgentList.tsx:1377-1382`. `feature/delivery-section-header` extends this; the plan says "one domain summary per section" as if new. The section icons are emoji in `SECTION_LABELS` (`delivery-view.ts:23-29`); `glyphs.ts` (37 lines) holds none of them, which conflicts with the constraint "icons only from glyphs.ts".
5. **A segmented bar exists.** `card-presentation.ts:100-122` (`kind: 'segments'`) and `Card.tsx:357-358` (`data-work-bar`) draw a plan card's work bar. A reuse candidate for the five-segment bar; Left to the Builder may cover it, but naming it saves a second bar.
6. **`sprintScope` is taken.** `packages/domain/src/rules/sprint-scope.ts:89` is fleetd's review/merge scope. The plan's "scope rule" for My sprint needs another name.
7. `SprintCardSchema` (`schema.ts:873`, field `end` at about `:901`) already carries `end` on the board payload; only `FleetSprintSchema` (`:4269`, confirmed) lacks it. The plan's claim holds; citing the board-side field shows the shape to copy.

## Stale citations (checked, minor)

- `readerIsKnown` is defined at `packages/domain/src/rules/ownership.ts:316`; `agent-rows/mine-filter.ts:186` only re-exports it. `Reader` is `ownership.ts:19-29`, not `23-30`. The `parsePersonDirectory` call is `server-info.ts:179`, not `:170`.
- Confirmed true: the four browser and three unit files selecting "This sprint" (`chip-row.test.ts` and `filtered-estate-totals.test.ts` are under `packages/domain/test/`); `chip-row.ts:116-117`; `schema.ts:2685-2705` `version`; `releaseVersion` at `tuple-row.ts:1055`; `ReleaseApprove.tsx`, `FleetControls.tsx`; no `Owner` in the template or in any of 32 sprint files.

## Waits

Every branch named in a `waits:` marker exists as a slice in a sibling (`delivery-you-groups`, `delivery-tickets-section`, `delivery-work-items-gates`), and siblings' waits on this plan name its real slices. `feature/delivery-slice-states` reaches the section header only through `delivery-you-groups`; that is consistent.

## Amend before approving

Rename the per-sprint field in the domain (for example `sprintLead` or `SprintHandle`) and add one sentence that it is distinct from the `Sprint owner` config key and `SprintOwner`; correct the Notes search claim. Make `feature/delivery-sprint-card` remove the `data-sprint-report` line. Make `feature/delivery-slice-states` move `delivery-view.ts:411-423` into the domain, and make `feature/delivery-release-card` replace the `data-release-line`, and state the change of meaning of "blocked". Say that the section header extends `SectionView`, and either move the section icons into `glyphs.ts` or drop the constraint. Fix the three stale line citations.
