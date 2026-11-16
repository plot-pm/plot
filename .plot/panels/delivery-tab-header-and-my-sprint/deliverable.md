# Juror: deliverable

Position: amend

Read: the subject plan, the sibling plans (grep-level for the six delivery plans, headings and waits markers), the design spec (grep), docs/stories (directory listing), .plot/templates/plan.md, scripts/check-plan-headings.sh, plot-plan-meta.sh waits syntax, sprint-record.ts, skills/plot/templates/sprint.md, DeliveryFilters.tsx, ReleaseApprove.tsx, glyphs.ts. Nothing was run beyond greps.

## Findings

1. misleads: slices 2, 3 and 4 carry no `<!-- waits: ... -->` marker (plan lines 79, 83, 87), although they depend on each other. Slice 3 (sprint card, release card people count) needs the Owner field from `feature/sprint-owner-field`. Slice 4 (scope on the status card) needs both `feature/delivery-tab-header-cards` and the Owner field. Siblings use the marker (delivery-release-plan-rows etc.; plan-meta.sh:134) and the release-progress plan waits on `feature/delivery-my-sprint-scope` by name, so ordering is machine-read. As written the fleet can dispatch all four at once.
2. misleads: slice 3 `feature/delivery-tab-header-cards` (line 83) bundles the to-do list with three markers, the triage line, the release card with five-segment bar and Approve button, one card per target release, the sprint card, the fleet card, and removal of the release row. That is at least four independent facts and views; likely too large for one PR. The fleet card, sprint card and release-row removal could each be their own slice; the sprint card also needs slice 2.
3. misleads: the to-do list's three markers depend on plan 2's placement rule (plan line 41: "until then from today's You groups"). No slice names the interim reader of today's You groups, and no slice states that it is replaced when plan 2 lands. Plan 2 (delivery-you-blocks-or-feeds.md:40) says the header reads the markers from its rule, but this plan has no waits or hand-off on plan 2. The "blocks delivery / input / clean up" count is not verifiable as built until that is resolved.
4. misleads: the Changelog promises a fleet card "with the fleet switches read-only" (line 19) and a link down to the Fleet section header; plan 5 (delivery-fleet-rows-per-agent) builds that Fleet header, so the link target is not built here. Slice 3 lists the fleet card but its link target is a later plan's artifact.
5. misleads: the reader identity for the toggle and the To-do "reader" is an open question (line 64, "not in People"). Slices 3 and 4 both need it; Done When has no item for it and it is not a Settled Question. A slice cannot be verified without that decision.
6. cosmetic: slice 2 says the Owner is "checked against People", but sprint-record.ts has no owner handling and no domain code reads People other than workflows/approve.ts; the plan does not say which refusal or display a handle not in People gets. Done When line 54 only tests the parse.
7. cosmetic: Done When has no item for the Approve release button appearing and enabling per ReleaseApprove.tsx, nor for "No release targeted", though both are in the Changelog/Approach (lines 18, 42).
8. cosmetic: the story link (line 28) points to docs/stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md, which does not exist in this worktree (docs/stories has only archived, nothing-changed-nothing-runs, the-master-agent-holds-the-fleet).
9. cosmetic: the renamed button is in DeliveryFilters.tsx with `data-chip="This sprint"` selected by four browser test files (DeliveryFilters.tsx:63-65). The plan's "renamed" slice does not mention the test updates.

## Checked, no finding
- Heading is `## Slices`, with `###` names per slice; passes check-plan-headings.sh.
- Slice 1 branch `feature/delivery-section-header` is the one sibling plans wait on.
- Board impact line matches slices 1 to 4 (template, parser, header, components).
- Section header "applied as sections stand" and counts later filled by plans 2 to 6 does not duplicate sibling builds.
