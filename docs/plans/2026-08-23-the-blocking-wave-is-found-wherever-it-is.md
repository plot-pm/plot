# The blocking wave is found wherever it is

> The info mark on a blocked wave finds its blocker only inside the same section. The blocker is usually in WORKING — a different section — so the click silently does nothing.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `bug/the-blocking-wave-is-found-wherever-it-is`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The *blocked by* mark now finds the wave holding a branch back even when that wave sits in another section, instead of silently doing nothing.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (BlockedByMark) and possibly App.tsx's reveal machinery. Rebuild the artifact. -->

## Motivation

Reported from the running board, 2026-08-23: *"The blocked (i) only works if the
wave is in the same group. Waves in other sections e.g., WORKING aren't
highlighted."*

The report is right — the mark silently does nothing across sections. What this
plan first recorded as the cause was wrong, and the correction is the reason it
is worth reading.

### The cause is a COLLAPSED SECTION, not a scoped query

`BlockedByMark` resolves its target with:

```js
document.querySelector(
  `[data-wave-list="${plan}"] [data-wave-row="${wave}"]`,
);
if (!target) return;
```

An earlier draft of this plan argued that `data-wave-list` is rendered per group,
so the query "finds the blocking wave only when blocker and blocked happen to
share a section". **That is not what the code does.** It is
`document.querySelector` with both attributes in ONE selector: it already
searches the whole document and already crosses sections. Widening it would
change nothing at all, and a worker implementing that fix would make a no-op,
run green tests, and report success.

The real cause is one line away, in `collapse.ts`:

```ts
export const COLLAPSED_BY_DEFAULT: WaitingGroup[] = ['quiet', 'done'];
```

and one comment away, in the renderer:

> The branches, folded. **Removed from the tree rather than hidden with CSS**,
> the same as the section fold: a folded group should cost no vertical space.

**A collapsed section has no rows in the DOM.** So when the blocker sits in DONE
— collapsed by default for every reader on every load — there is nothing for any
selector to find, and `if (!target) return` fires.

### The plan named the answer and filed it as an aside

This is not a new discovery so much as a correction of emphasis. The earlier
draft already said:

> A wave that is **not rendered at all** — filtered out, inside a folded section,
> or on the other tab — is not reachable by any selector.

and treated it as the rare secondary case behind the query fix. **It is the
primary case, and the query fix is the empty one.**

### What the estate actually shows

Measured 2026-08-24:

```
4 plans render waves in TWO sections (done + not-started)
9 blocked waves; every one sits in `not-started`
2 rows carry `blockedBy`; both blockers are in `not-started` too
```

So the *cross-section* case the report describes is real but narrower than the
first draft claimed: it needs a plan whose blocker has completed into DONE while
a later wave is still blocked. `the-agents-tab-filters-to-the-sprint` is exactly
that shape today — three complete waves in DONE, two blocked in NOT STARTED.

**`deriveWaves` gives a wave only `done` or `not-started`.** There is no
`working` section for a wave to be in, so the first draft's *"the blocker is
usually in WORKING"* described a state the model cannot produce. That sentence
predates `a-wave-is-one-row`, which made a wave's section unique.

### Why it survived

**`if (!target) return;`** — no scroll, no message, no console error. A reader
clicks and the interface ignores them, which reads as a dead control rather than
a row that could not be found. There is no signal to notice, which is why this
was reported from the board rather than caught by a test.

## Design

### Expand the section, then scroll

The target is absent because its section is folded, so the mark must unfold it
before it can find anything. The order matters and is the whole mechanism:

1. Resolve which section holds the blocking wave — the payload says, in the
   wave's own `section`.
2. If that section is collapsed, expand it.
3. Then query, scroll and flash, exactly as today.

The existing query is kept unchanged. It is already document-wide and already
correct; it was only ever looking for a row that was not there.

### Expanding on the reader's behalf is a real cost, and it is accepted

`readCollapsed` / `writeCollapsed` persist to `localStorage`, so unfolding DONE
does not just reveal a row — **it changes the reader's layout until they fold it
back.** The board is otherwise careful about acting on a reader's behalf, and
this is a deliberate exception rather than an oversight.

It is accepted because the alternative is worse: the reader ASKED *which wave*,
and answering with silence is what this plan exists to remove. A section that
opens in response to a click the reader made is a consequence they can see and
undo; a control that does nothing is one they cannot.

**Expand only the ONE section holding the target**, never a general unfold, and
never a fold — the mark may open a section and must never close one.

### Say so when it still cannot be reached

Unfolding does not cover every case. A wave filtered out of view, or on the other
tab, is still unreachable — and after this change those are the only remaining
ones.

**A silent no-op is not acceptable in either branch.** Where the row cannot be
reached, the mark states the wave's name and that it is not on screen. The reader
then has the answer to *which wave* — which was the question — even when the
board cannot take them to it.

### Not chosen: widen the query

The first draft's fix. Rejected because the query is already
`document.querySelector` and already crosses sections: the change would be a
no-op that passes every test written for it. Recorded so the next reader does not
re-derive it from the same misreading.

### Not chosen: render collapsed sections hidden rather than removed

Keeping folded rows in the DOM with `display: none` would make the query work
untouched. Rejected: the renderer removes them deliberately — *"a folded group
should cost no vertical space, which is the whole complaint this answers"* — and
this repo has already paid for that decision once.

### Not chosen: reuse `revealBranch` wholesale

Tempting, since it crosses tabs and sections. Rejected for now because it keys on
a **branch**, and this mark points at a **wave** — a wave has no single branch,
and picking one would be inventing an answer.

## Done when

- **A blocked wave whose blocker is in a COLLAPSED section scrolls to and
  flashes it.** This is the defect. Asserted in a browser test that leaves DONE
  folded — its default state — because a test that expands it first passes
  against today's broken code.
- **The section is expanded, and only that one.** Asserted on the other
  sections' state: a mark that unfolds everything would pass a
  "did it scroll" test while rearranging the reader's board.
- **The mark never FOLDS a section.** It may open; it may not close.
- **A blocker in the same, already-open section still works** — the case that
  works today must not regress, and it is the one a fix aimed at collapse could
  break.
- **A blocker that cannot be reached at all produces a visible statement, not a
  no-op.** Asserted directly: this is the property that made the bug invisible,
  and an implementation that only handles the collapse case passes every other
  assertion here.
- **The query is unchanged.** Asserted by reading the diff — if the selector
  moved, the change was aimed at the first draft's cause rather than the measured
  one.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Waves


<!-- IN FLIGHT ALONGSIDE `the-row-says-whether-you-can-start-it` (2026-08-24),
     which is editing `row-identity.ts`, `schema.ts`, `fleet.ts` and
     `mock-fleet.ts`. This branch's work is `BlockedByMark` in `AgentList.tsx`
     and the collapse state in `collapse.ts`, so the overlap is small — but
     both land in `packages/board/src`, so merge `origin/main` before opening
     the PR rather than at merge time. -->

### Found (Branch: bug/the-blocking-wave-is-found-wherever-it-is)
- widen the query to the document, and say so when the target is not on screen

## Notes

Reported from the running board, 2026-08-23, and the report was right about the
symptom in every detail.

### The first draft named the wrong cause, and that is the lesson

It argued the query was scoped to one section's list. The code disagrees: it is
`document.querySelector` with both attributes in one selector, already
document-wide. **The proposed fix would have been a no-op that passed its own
tests** — a worker would have widened an already-wide query, seen green, and
reported success while the mark went on doing nothing.

The real cause is that DONE is `COLLAPSED_BY_DEFAULT` and a folded section's rows
are removed from the DOM rather than hidden. The draft knew this — it wrote *"a
wave that is not rendered at all — filtered out, inside a folded section, or on
the other tab — is not reachable by any selector"* — and filed it as the rare
secondary case behind the query fix. It is the primary case.

Two mistakes compounded, and both are worth naming because both recur:

1. **Reasoning about the code from its docstring rather than from the code.**
   `BlockedByMark`'s own comment claims the target is "always reachable" as a
   sibling in the same list. That comment is what the draft read, and it is wrong
   about a board that groups by attention.
2. **Reasoning about waves in the vocabulary of rows.** *"The blocker is usually
   in WORKING"* describes a section a WAVE cannot occupy: `deriveWaves` gives a
   wave only `done` or `not-started`. The same two-vocabularies confusion caused
   the miscount fixed in #378 the same night.

### The estate, measured 2026-08-24

```
4 plans render waves in two sections (done + not-started)
9 blocked waves, every one in `not-started`
2 rows carry `blockedBy`, both blockers in `not-started`
```

`the-agents-tab-filters-to-the-sprint` is the live example of the failing shape:
three complete waves folded into DONE, two blocked waves in NOT STARTED pointing
at them.

Precedent: `the-name-track-holds-the-name` (Delivered) had its settled mechanism
overridden after a worker measured it in Chromium and found it
self-contradictory. This plan is corrected one step earlier — before dispatch
rather than after — which is what the interrogation is for.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "The plan says the blocker is usually in WORKING, but deriveWaves gives a wave only done|not-started - is the premise true?", "a": "It is not. Measured: 9 blocked waves all in not-started, 2 blockedBy rows with same-section blockers. The operator confirmed from use that the mark still fails across sections, which sent the investigation to the real cause.", "category": "technical"},
    {"q": "If the query is already document-wide, why does it fail?", "a": "DONE is COLLAPSED_BY_DEFAULT and a folded section's rows are REMOVED from the DOM, not hidden. There is nothing to find. The draft's fix - widening the query - would have been a no-op passing its own tests.", "category": "technical"},
    {"q": "Is expanding a collapsed section on the reader's behalf acceptable?", "a": "Yes, and the cost is stated: writeCollapsed persists to localStorage, so it changes the reader's layout until they fold it back. Accepted because the reader ASKED, and silence is the defect. Only the one section holding the target; never a fold.", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": false,
    "ux": true,
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
