# A plan that joins a sprint names the sprint

> A plan added to a sprint after the sprint starts keeps an empty `Sprint:` field, because only `/plot-sprint`'s creation flow writes it; this plan makes a later addition write the field in the same commit as the sprint-file change, and gates a sprint file whose member plan disagrees with it.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2999
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- Adding a plan to a sprint — at creation or later as a scope change — writes the plan's `Sprint:` field in the same commit as the sprint-file change, and a gate refuses a sprint file whose member plan names no sprint or a different one.

<!-- Board impact: touches the sprint-membership writer and plan-state scripts;
     a new gate may touch CI or plot-state-gate.sh. Not yet assessed — this is
     the open question list below. -->

## Motivation

A plan that joins a sprint after the sprint starts keeps an empty `Sprint:`
field. Only `/plot-sprint`'s creation flow writes the field
(`skills/plot-sprint/SKILL.md:336-342`, step 6 "Update Plan Files"). Nothing
writes it when a plan is added later, and nothing checks that a sprint
member's plan names its sprint.

Measured 2026-11-01 on `docs/sprints/2026-W44-delivery-loop.md`: 3 of its 15
member plans named no sprint. All 3 joined through a Scope Changes commit that
changed only the sprint file:

- `the-plan-walk-moves-into-the` (#2980): no `Sprint:` line at all;
- `the-commit-gates-match-only-the` (#2974): no `Sprint:` line at all;
- `every-plan-reference-shows-its-issue` (#2993): an empty `Sprint:` line.

They were fixed by hand in `a9d743627` and `b3e145659`. Step 6 is a rule in
prose, and a master agent's hand edit of the sprint file did not follow it.

`plot-reconcile-scan.sh` already reports this drift read-only, in three
sections that exist today and are not duplicated by this plan:

- `== 9. Unplanned sprint members ==` — a sprint member whose slug names no plan.
- `== 10. Sprint field unset ==` — a plan listed by a sprint carries no `Sprint:` field.
- `== 11. Sprint mismatch ==` — a plan's `Sprint:` names a different sprint.

Those sections answer *is something wrong right now*, reported for a person to
fix by hand. This plan answers two different questions: *can the wrong state be
written in the first place* (the writer), and *can a commit land that leaves it
wrong* (the gate). Neither exists today.

## Design

### Approach

<!-- How will this be implemented? Key architectural decisions.
     Monorepo layout: skills live at the repo root; the board is a package under
     packages/. A change to the plan format or helper scripts often has board
     implications — call them out here. Design decisions must pass the
     MANIFESTO.md 9-question checklist. -->

### Open Questions

- [ ] Is the writer a new action on `plot-sprint-state.sh`, a domain rule behind a bundle, or a board controller endpoint?
- [ ] Does the gate run at commit time (like `plot-state-gate.sh`) or in CI (a `scripts/check-*.sh`), or both?
- [ ] Does a plan in Deferred keep the sprint's name?

## Slices

- `feature/a-plan-that-joins-a-sprint` — <description>

## Notes

<!-- Session log, decisions, links. Definition of Done: docs/definition-of-done.md -->
