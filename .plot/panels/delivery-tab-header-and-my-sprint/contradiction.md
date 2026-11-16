# Contradiction lens: delivery-tab-header-and-my-sprint

Position: amend

## What I read

- Subject plan and design spec in full.
- Sibling plans 2 to 6: grepped for slice names, `waits:` annotations, scope, marker and header statements (not read line by line). The two bug plans (a-deferred-slice-keeps-its-branch, red-hold-reads-the-pr-base) share no surface with this plan beyond their names; no conflict seen.
- Code opened: packages/domain/src/rules/sprint-record.ts, skills/plot/templates/sprint.md, packages/domain/src/rules/chip-row.ts, packages/board/src/app/components/DeliveryFilters.tsx (head), ReleaseApprove.tsx (head), packages/domain/src/rules/ownership.ts and entities/person.ts (exports).
- Not opened: glyphs.ts, existing Delivery tab section code beyond the above. Nothing was run.

## Findings

1. **misleads** - Story link is dead. Plan line 28 (and the Status `Story:` line 11) point at docs/stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md. That directory does not exist in this tree (`docs/stories/` holds archived, nothing-changed-nothing-runs, the-master-agent-holds-the-fleet; `git ls-files` finds only the spec). Line 60 says "the story names issue #3468"; no file says it, and #3468 appears in no active plan. Siblings 2 to 6 carry the same link.

2. **misleads** - "My sprint" disabled rule differs from the design and from today's code. Design (The "My sprint" Toggle): disabled "when no sprint is active". Plan line 40 and Done When: disabled "when the reader owns no Active sprint". Today `sprintChip` (chip-row.ts:116-117) disables only when no sprint is Active, and the chip selects every Active sprint (selected empty = all, chip-row.ts:105-120). The plan changes the semantics from "any Active sprint, multi-select per-sprint chips" to "owner-scoped". The plan does not say what happens to the per-sprint chips (DeliveryFilters.tsx `selectedSprints`, `onToggleSprintSlug`) or to the four browser tests that select `[data-chip="This sprint"]` (DeliveryFilters.tsx comment on `dataChip`). The rename to "My sprint" therefore also needs a decision on `data-chip`.

3. **misleads** - Transition cost of the owner rule. Every existing sprint file under docs/sprints has no `Owner:` (grep: zero hits). The plan says a sprint with no Owner "belongs to nobody's toggle", so on day one no reader owns an Active sprint and the toggle is disabled for everyone. The plan and the design both state this, but neither names it as a consequence, and the Done When bullet "the toggle switches the status card..." cannot be shown on current data.

4. **misleads** - Slice order inside the plan is not declared. Siblings annotate `<!-- waits: feature/delivery-section-header -->`. This plan's four slices carry no `waits:`. But `delivery-tab-header-cards` needs the section-header component (named in line 38, 83) and the people count (line 42), which needs `sprint-owner-field`. `delivery-my-sprint-scope` (line 87) needs `sprint-owner-field` and the cards slice. Plan 5 line 55 already waits on `feature/delivery-my-sprint-scope`, so the missing edges here matter for dispatch eligibility.

5. **misleads** - Marker ownership is circular and unsequenced. Plan line 41: plan 2 decides the markers; plan 1 reads "the rule plan 2 refines, and until then from today's You groups". Plan 2 line 40: "The to-do list in the tab header (plan 1) reads the same markers from this rule." Plan 1 shipped first has to map today's groups (Input to the fleet / Review a result / Unblock, per the design's "Changes to the 2026-11-08 Design") onto blocks-delivery / input / clean-up, including the PR rule (design: PR blocks delivery when person comment unanswered / budget spent / no `Auto-review: true`). That mapping is exactly plan 2's `delivery-you-groups` slice. Plan 1's `delivery-tab-header-cards` slice and plan 2's slice have no declared order, so two rules for the same marker can land.

6. **misleads** - One Approve button per release value does not match the button's input. Plan line 42 (and design Calls: "each with its own Approve button") gives one card per `Release:` value. `ReleaseApprove.tsx` takes one release PR row (`approveRelease(number, headSha)`, `releaseApprovable`), and `plot-ask.mjs release-approve <pr> <sha>` works on a `changeset-release/` PR. The plan names no rule that maps a sprint's `Release:` value to a release PR, so a second card has no PR to bind its button to. The same gap exists in the design; the plan inherits it and its Open Questions do not list it.

7. **cosmetic** - Progress bar. Design "Tab Header" says four segments; "Calls Made After Review" says five and overrides it. The plan follows five (correct). Noting only because the design's own section still reads four; the plan does not mention the override by the "four" text.

8. **cosmetic** - Open Question (line 64, reader not in `People`) is real: `Reader` (ownership.ts:23-30) carries `hostUser`, `gitEmail` and `directory`, and `resolvePerson`/`samePerson` (person.ts:43,164) compare by handle. The plan's two options ("git user name" vs "no handle") ignore `hostUser`, which is how the board already identifies the reader. Not a contradiction, a missing third option.

## No contradiction found

- Section header owner: plan 1 owns it; plans 2 to 6 each wait on `feature/delivery-section-header`. Branch names match (`feature/delivery-my-sprint-scope` in plan 5 line 55).
- Scope rule: Fleet and Tickets unscoped agrees with plans 4, 6 and the design; You, Work items, Release delivery scoped agrees with plans 2, 3, 5.
- Release row removal under Work items agrees with the design.
- `People` handling: `sprint-record.ts` reads Status fields with one regex per field (lines 69-77), so an `Owner:` field fits the existing shape; `People` resolution lives in domain `entities/person.ts` as the plan says.
- Terminology: the plan uses Slice, Agent, Worker consistently; no `Wave` for a slice.
