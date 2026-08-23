## Implementation brief — the-name-track-holds-the-name (wave: Widened)

- **Plan:** `docs/plans/2026-08-22-the-name-track-holds-the-name.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `bug/the-name-track-holds-the-name` (base: `main`)
- **Ends as:** one PR to `main`

**Adjacent to the sprint's pivot.** `bug/a-wave-is-one-row` is rewriting
`AgentList.tsx`, which renders rows *through* `TupleRow.tsx`. Expect a rebase;
keep the diff small so it is cheap.

### What to build

**Two problems, and fixing either alone leaves the other standing.**

**A — the track is too narrow.** Slot 3 is a fixed `12rem` while slot 4 takes
`1fr`. On a plan-group head slot 4 is *empty*, so the flexible track absorbs
width the name needed. Measured: `feature/the-sections-carry-the-fleet-controls`
(44 chars) renders in full while `approval-hands-the-wo…` clips at ~20 — **on the
same row**. **80% of this repo's plan slugs (75 of 94) exceed the visible width.**

**B — a row clips even with space available.** `truncate` is unconditional
(`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`); it ellipsises
whenever the *box* is narrower than the text, and the box comes from the track,
never from the space the row has.

**Why A alone fails:** it moves B's threshold. A 40-char name fits a wider track;
a 50-char one still clips with the row half empty.

### The decisions the plan settles — do not re-derive them

**`minmax(12rem, auto)`** — floor stays, grows into slack slot 4 is not using.

**The 604px/640px arithmetic test must pass UNMODIFIED.** `minmax` keeps the
floor at 12rem so the figure is unchanged. **If the test fails, the change is
wrong — do not edit the test to fit it.**

**Do NOT middle-elide the plan slug.** Measured: at 19+ characters **zero** slugs
collide. That solves a problem the data does not show and makes every name harder
to scan.

**Assert string EQUALITY, not "longer than before."** Render a name that clipped
at the old width, on a viewport with visible free space, and assert the rendered
text equals the **full name**. "More characters than yesterday" passes a fix that
only moved the threshold.

### Open question the plan leaves you

Does `minmax(12rem, auto)` satisfy the existing *exactly one flexible track*
assertion, which filters on `/^[\d.]+rem$/`? **Resolve by reading the assertion's
intent, not by relaxing it to pass.**

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm run test:board` green, artifact rebuilt and committed, a changeset.

### Bookkeeping

`→ #<number>` on `main` when the PR exists. **Push early; run tests in the
FOREGROUND.**

### Scope guard

`TupleRow.tsx` and its guard test. **Not** `AgentList.tsx` — the pivot owns it.

**Do not commit the tiny-garden `last-pulse.json`.**
