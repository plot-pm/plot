## Implementation brief — activity-shows-itself, wave 3 (Fold)

- **Plan (canonical):** `docs/plans/2026-08-17-activity-shows-itself.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #179 merged (two interrogation rounds)
- **Branch:** `feature/group-shows-inner-activity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

A **group heading** carries the activity marker when any of its rows is
active — so a collapsed group still says that something inside it is
being written to.

Wave 4 (`unpushed-work-shows-still`) is **not yours**.

### The measurement

Reported as the sharper half of the activity request: *can the group
carry a marker too, so activity is visible while the group is collapsed?*

Measured, the folded heading shows only a stock count:

```tsx
{rows.length > 0 ? `(${rows.length})` : hint}
```

`(4)` means *four rows are in here*. It does not mean any of them is
moving. And the comment above it says why the number exists at all —
*"a folded header with no number reads as nothing here"* — it was
introduced to separate **absence from emptiness**, not to report change.

**This is not hypothetical.** QUIET and DONE start collapsed by default,
and the choice persists in `localStorage`. The comment names QUIET's
purpose exactly: *"go check whether this died"*. A group whose entire job
is to surface possible deaths is folded shut and shows a stock count.

### Five decisions the plan settles — do not re-derive them

**Binary, not a second number.** The heading says *at least one row in
here is active*, or nothing. `(4, 2 active)` was the alternative and is
rejected: `(4)` exists to separate *absent* from *empty*, a distinction
this board paid for, and a second figure beside it dilutes the one job
that number has. A reader opening a group does not need to know whether
it is one row or three — they need to know whether opening it is worth
it.

**The heading carries it folded AND open.** Hiding it when expanded was
considered — the rows show it themselves, so the heading would be
redundant — and rejected because the marker would then vanish at the
moment of expanding, which reads as *it stopped*. **A marker that
disappears when you look closer is worse than one that repeats itself.**

**Derived at render, never stored.** `rows.some(isActive)` computed from
the same pulse the rows read. No new field, no new state, and it cannot
disagree with the rows beneath it — the way a separately-maintained count
could.

**The same mark, one level up.** Wave 2 (#189) made the row's marker a
left-edge bar; wave 1 of `working-rows-show-their-pace` (#194) gave it a
travelling dot at two speeds and aligned it to the row's first line via
`sm:top-2`. The heading's marker is that same shape — a reader who learnt
it on a row must not have to learn it again on a heading. Whether it
travels there is your call: the plan does not settle it, and a heading is
not a row. **Report which you chose and why.**

**`motion-reduce` keeps the marker and stops any animation**, and it is
`aria-hidden`: the heading's own text and the group's rows carry the fact
in words. The rule this repo has now written five times.

### Done when

- **A collapsed group with an active row carries the marker.** Assert
  against a folded group — the reported case, and the one no test covers
  today.
- **A collapsed group with no active row carries nothing.** Assert the
  absence: a heading that always shows the mark says nothing.
- **The heading keeps the marker when expanded.** The pairing that
  matters: hiding it on expand passes the collapsed assertion and makes
  the mark read as *stopped* at the moment of opening.
- **The heading's marker cannot disagree with its rows.** Assert it is
  derived from the same rows at render — no separate count, no stored
  state.
- **A row folded out of sight still counts.** Assert a group whose only
  active row is hidden by the fold: that is precisely the case the marker
  most needs to reach.
- **`(4)` still means what it meant.** Assert the tally is unchanged — it
  separates absent from empty, and that job is not being extended.
- **`motion-reduce` keeps the marker**, and it is `aria-hidden`.
- **The row markers are untouched** — `[data-live-dot]`,
  `[data-change-mark]`, `[data-stuck-cue]` and the activity mark all
  render as before.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check `git branch
--show-current` is `main` before that edit.**

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the group heading) and
its tests.

**Do NOT change `isActive`, the lock echo, or the contract** — wave 1
settled all three.

**Do NOT build wave 4** (`unpushed-work-shows-still`), and do not add a
second mark to the heading.

**Do NOT touch the tally**, the section fold, or `NOT STARTED`'s plan
rows.

**`the-line-flashes-on-any-written-update` is eligible in the same
file** and may be dispatched alongside you — it widens `watchedState` and
touches the change-mark, not the heading. Rebase rather than race.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those; the
collapsed-heading assertions want the browser suite.

**The agents-tab browser suite opens NOT STARTED's fold** via an
`expandPlans` helper — if you add a test there, follow that idiom.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**GitHub's API failed with `503` repeatedly today**, on GraphQL and REST
both. `gh pr view` uses GraphQL and may return **empty** values — which
are not `false`. If a push or merge appears to fail, **check the result**
via `gh api` rather than trusting the error.

**Two known CI flakes — neither is yours:** Playwright's CDN `403`, and
`discovery.test.mjs` counting `plot-board-branch-*` in a shared
`os.tmpdir()`. Report rather than work around.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
