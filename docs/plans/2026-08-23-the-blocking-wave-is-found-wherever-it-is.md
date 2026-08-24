# The blocking wave is found wherever it is

> The info mark on a blocked wave finds its blocker only inside the same section. The blocker is usually in WORKING — a different section — so the click silently does nothing.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The *blocked by* mark now finds the wave holding a branch back even when that wave sits in another section, instead of silently doing nothing.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (BlockedByMark) and possibly App.tsx's reveal machinery. Rebuild the artifact. -->

## Motivation

`BlockedByMark` resolves its target with one query:

```js
document.querySelector(
  `[data-wave-list="${plan}"] [data-wave-row="${wave}"]`,
);
if (!target) return;
```

`data-wave-list` is rendered per **group**, and groups are nested inside the
attention **section** they belong to. A plan whose waves are spread across
sections therefore renders *several* `data-wave-list` elements with the same
plan name, each holding only that section's waves.

So the query finds the blocking wave only when blocker and blocked happen to
share a section. **The common case is that they do not**: a wave is blocked
precisely because an earlier wave is still being worked, and a wave being worked
is in WORKING while the blocked one is in NOT STARTED.

### The premise this contradicts, stated in the code

`BlockedByMark`'s own docstring argues the target is always reachable:

> **Why the target is always reachable** — The blocking wave is a SIBLING in the
> same list — a plan's waves all render together, so `Shaped` is one or two rows
> above `Moved` whenever `Moved` says it is blocked. That is why this needs none
> of App's reveal machinery (`revealBranch`, `highlightBranch`, the nonce): those
> exist to cross tabs and sections to find a row that may not be rendered.

Every clause of that is a reasonable belief about a board that groups by plan.
This board groups by **attention**, so the premise is false and the machinery it
declines is exactly the machinery it needs.

### Why it was not noticed

**`if (!target) return;`** — the failure is silent. No scroll, no message, no
console error. A reader clicks and the interface ignores them, which reads as a
dead control rather than as a row that could not be found. There is no signal to
notice, which is why this survived until an operator reported it from the board
rather than from a test.

## Design

### The fix

Search the **document**, not one list. The two attributes
(`data-wave-list` for the plan, `data-wave-row` for the wave) already identify
the row uniquely across the page — wave names repeat across plans, which is why
the pair is scoped by plan, and that reasoning is unaffected by which section
the row sits in. Only the *root* of the query is wrong.

Where several sections render the same plan, the pair still matches at most one
row: a wave belongs to exactly one group, and a group to exactly one section.

### The case the query cannot fix

A wave that is **not rendered at all** — filtered out, inside a folded section,
or on the other tab — is not reachable by any selector. That is what
`revealBranch` / `highlightBranch` exist for, and the docstring is right that
they are heavier. The honest split:

- **rendered, another section** → the widened query finds it. The common case.
- **not rendered** → the mark must SAY so rather than doing nothing.

**A silent no-op is not acceptable in either branch.** If the row cannot be
reached, the overlay says the wave's name and that it is not on screen — the
reader then knows the answer to *which wave*, which was the question, even when
the board cannot take them there.

### Not chosen: reuse `revealBranch` wholesale

Tempting, since it already crosses sections and tabs. Rejected for now because
it keys on a **branch**, and this mark points at a **wave** — a wave has no
single branch, and picking one would be inventing an answer. Wiring a
wave-shaped reveal is a larger change than the defect warrants; the widened
query plus an honest fallback fixes the reported case without it.

Revisit if the *not rendered* case turns out to be common.

### Open Questions

- [ ] Should the mark also expand a **folded** section to reach its target? That
      is a state change on the reader's behalf, which the board is otherwise
      careful about. Probably yes for a fold the reader can see, but decide it
      deliberately rather than as a side effect of scrolling.

## Done when

- A blocked wave in NOT STARTED whose blocker is in WORKING scrolls to and
  flashes that blocker. Asserted in a browser test with a pulse that puts the
  two waves in **different sections** — the current test, if any, cannot fail
  this way because it builds both in one.
- A blocker in the same section still works — the widened query must not regress
  the case that worked.
- A blocker that is **not rendered** produces a visible statement, not a no-op.
  Asserted directly: this is the property that made the bug invisible, and an
  implementation that merely widens the query passes every other test here.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Waves


### Found (Branch: bug/the-blocking-wave-is-found-wherever-it-is)
- widen the query to the document, and say so when the target is not on screen

## Notes

Reported from the running board, 2026-08-23: *"The blocked (i) only works if the
wave is in the same group. Waves in other sections e.g., WORKING aren't
highlighted."*

The defect is one selector root, but the reason it shipped is worth keeping: the
docstring reasoned carefully from a premise about layout that the layout does not
hold. The comment is not wrong about what it argues — it is wrong about the
board it argues over — which is the failure mode a confident comment produces and
a test would have caught.
