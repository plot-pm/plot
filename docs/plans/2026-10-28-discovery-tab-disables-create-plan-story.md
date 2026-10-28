# Board: Discovery tab disables Create plan/story with "no issue read" until the Delivery tab loads the fleet

> The Discovery tab reads `issueAnswer` from a fleet payload that only loads on the Delivery tab, so a fresh Discovery page shows Create plan and Create story as unavailable on a host whose issue read works.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2833
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Board: the Discovery tab shows Create plan and Create story as available when the host's issue read works, including on a page opened or reloaded on `?tab=discovery`. While the issue read is not yet known, the buttons show a loading state instead of the Bitbucket refusal.

<!-- Board impact: board-only change in packages/board. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

On a GitHub repository whose issue read works, a fresh page on `?tab=discovery` shows every ticket's Create plan and Create story as unavailable, with the reasons `this git host has no issue read, so an issue cannot become a plan from here` and `this git host has no issue read, so a ticket cannot become a story from here`. The server disagrees: `/api/fleet` answers `issueAnswer: "answered"` (5 of 5 reads, 4 issues) and `/api/board` answers `idea` and `story` as `available: true`. Board 2.29.0 (marketplace `991ceb6`). Workaround: open the Delivery tab once, then return to Discovery.

Cause, from the issue:

- `packages/board/src/app/App.tsx:516` returns before `loadFleet()` and its poll unless `tab === 'delivery'`.
- `packages/board/src/app/App.tsx:1338` passes `issueAnswer={fleet?.issueAnswer ?? 'unsupported'}` to the Discovery tab.
- A page that opens or reloads on Discovery has `fleet === null`, so both buttons take the `unsupported` branch of `refusalReason` (`CreatePlanButton.tsx:84`, `CreateStoryButton.tsx:94`) and print the Bitbucket sentence.
- A second effect: after one visit to Delivery, Discovery keeps that fleet reading with no poll, so an issue read that starts to fail later does not show on Discovery.

A missing reading is not a host fact. The page presents "not loaded yet" as "unsupported".

## Design

### Approach

Two changes, one per defect:

1. **Give "not loaded yet" its own state.** `issueAnswer` takes a value for "no reading yet" that `refusalReason` renders as loading, never as the `unsupported` sentence. The default `?? 'unsupported'` at `App.tsx:1338` goes away.
2. **Give Discovery a source for `issueAnswer` that stays fresh.** Either load and poll the fleet while the Discovery tab is open too (extending the `tab !== 'delivery'` guard at `App.tsx:516`), or move `issueAnswer` into the board payload the Discovery tab already polls. The second option removes the dependency on a second endpoint; the choice is the first open question.

Layering: per CLAUDE.md, every rendered state is a domain property. The decision "available, loading or refused, and with which wording" belongs in a domain rule that a unit test asserts without a browser; the `.tsx` components render it. One browser test proves the Discovery buttons are enabled on a fresh `?tab=discovery` page.

### Open Questions

- [ ] Poll the fleet on Discovery, or move `issueAnswer` into the board payload? The first costs a second 4 s poll on a tab that now needs only one field; the second changes the payload contract.
- [ ] Does any other Discovery or Stories control read `fleet?.…` with a `null` default that has the same defect? `StoriesTab.tsx:504` passes `issueAnswer` to `CreatePlanButton` as well.

## Slices

### Discovery reads the issue answer

- `bug/discovery-tab-disables-create-plan-story` — a "loading" state for an unread `issueAnswer`, and a fresh source for it on the Discovery tab, with a unit test on the domain rule and a browser test on `?tab=discovery`

## Notes

- Source: tracker issue #2833, https://github.com/plot-pm/plot/issues/2833. Created unattended from that issue: Type `bug` given in the prompt, `State: Draft` because the prompt gave no `Design:` answer. Nothing is written to the tracker.
