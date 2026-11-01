# Every plan reference shows its issue and opens the plan

> One shared component renders a plan reference everywhere, carrying its issue prefix and its link, so a reader can tell that two elements on the board name the same plan.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2993
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Every surface that names a plan shows the same issue prefix and opens the plan the same way; the duplicate label and href helpers are removed.

<!-- Board impact: yes — this plan's whole subject is the board's rendering of a
     plan reference (contract/schema.ts, lib/tuple-row.ts, lib/agent-rows/,
     several components/*.tsx). Rebuild the board artifact once the contract
     changes. -->

## Motivation

The board shows one plan in several different ways. About 14 sites render a plan reference, and each builds its own text and link: the plan head shows `1090: slug`, branch/PR/agent/slice rows show the bare slug, the Planning card and story modal show the title, Delivery rows and the sprint panel show the slug, the agent panel shows the file name. The plan-level verify/design/spec rows pass `issues: []`, so the plan loses its number there even when it has one. Link targets vary too: in-app route, in-app button, `DocModal`, a GitHub file in a new tab, or plain text with no link at all.

A reader cannot tell that two elements on the board name the same plan, because neither the label nor the link is consistent. The data backing this is uneven: `Card.issues` and `DraftPlan.issues` carry a plan's issue keys, but `AgentRow`, `Slice`, the verification/design/spec rows, `StoryPlanRef`, `SprintMember` and the agent panel do not — so most surfaces cannot show the issue prefix without a client-side card lookup even if they wanted to.

## Design

### Approach

<!-- To be filled in during Design review / interrogation. The issue names the
     required behaviour; the open questions below are the design decisions a
     reviewer needs to settle before slices are written. -->

The required behaviour, from the issue:

1. A reference to a plan that has one or more issues always shows the issue prefix, on every surface, in one format.
2. A reference to a plan that exists always links to the plan, and the link opens the plan the same way on every surface.
3. One component renders a plan reference, and every surface uses it. The duplicate label and href helpers (`planLink`, `planNameLabel`, the slice row's inline href, `tupleFromPlan`) are removed.
4. The decision is a domain property: the domain gives each plan reference its display name, its issue keys and its link target, so a unit test asserts the prefix and the link without a browser (CLAUDE.md, "Every rendered state is a domain property").
5. A reference to a plan that does not exist yet (the inferred plan on an issue row) shows no link, and it shows its issue number.

### Open Questions

- [ ] Which name does a reference show: the title, the slug, or both?
- [ ] Which link target is the standard: the in-app plan panel, or the plan file on the git host?
- [ ] Does each payload carry the plan's issue keys, or does the client resolve them from the card through one shared lookup?

## Slices

- `feature/every-plan-reference-shows-its-issue` — give every plan-naming site a domain-derived display name, issue prefix and link target, through one shared component <!-- builds: a shared PlanReference domain property + component -->

## Notes

Created from tracker issue #2993 (https://github.com/plot-pm/plot/issues/2993). The issue is the problem statement, not a spec to copy verbatim — the open questions above are carried from it unanswered; a reviewer settles them before slices are drafted.

A related, already-released plan — `2026-10-17-a-planned-issue-shows-its-plan.md` — solved the inverse direction (an issue row shows the plan that answers it). This plan is about a plan reference showing its issue, on every surface that names a plan; the two are complementary, not overlapping.
