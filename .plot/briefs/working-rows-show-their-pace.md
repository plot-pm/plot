## Implementation brief — working-rows-show-their-pace, wave 1 (Pace)

- **Plan (canonical):** `docs/plans/2026-08-17-working-rows-show-their-pace.md` on `main`
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #190 merged
- **Branch:** `feature/working-rows-show-their-pace` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

Two changes to `ActivityMark`, in this order, as **two separate
commits**:

1. **It aligns to the row's first line**, not the row's vertical centre.
2. **It becomes a track with a travelling dot**, at two speeds.

Wave 2 (the widened whole-line flash) is **not yours**.

### The alignment defect — fix this first

Reported live. The mark centres on the whole row:

```
sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2
```

and its own comment states the assumption underneath: *"The row is
`py-2` around one line of `text-sm`, so 20px spans nearly its full
height."*

**That assumption broke when the stuck cell landed.** It renders as its
own line beneath the six columns (`col-start-2 col-end-[-1]`), so a row
carrying a status line is roughly twice as tall — and `top-1/2` puts the
marker *between* the two lines instead of beside the branch name.

The mark belongs to the **branch**, and the branch is on line one
whatever else grows beneath it. Align to that.

This is the third consequence of the same change — the stuck cell also
started at the wrong x and its cue survived at a dead end, both fixed the
same day. Anything measuring itself against the row's height is suspect;
check for others while you are here and **report** what you find rather
than fixing outside scope.

### The travelling dot, at two speeds

A short horizontal track where the bar is today, with a glowing dot
travelling along it **and back**.

| Row | Speed | Because |
|---|---|---|
| `local_dirty` or `local_locked` | **fast** | someone is writing, measured |
| in WORKING, neither signal | **slow** | claimed; nobody knows |

Both states are live right now, so assert against them:

```
feature/not-started-counts-plans  dirty=true   → fast
bug/green-never-outranks-unknown  dirty=false  → slow  ("claimed, no known worker")
```

**The speed is a fact, not decoration.** Fast means *being written to
right now*; slow means *claimed and unobserved*. One rule, two states the
board can defend.

### Five decisions the plan settles — do not re-derive them

**The dot must never arrive.** It travels out and back. This is the only
reason travel is acceptable here: rotation and travel were refused twice
in this repo because they *"imply progress toward completion, which
nothing here measures"* — and a dot that returns promises no
destination. It reports a **rate**, not a distance. A fix that fills,
completes or arrives reintroduces exactly what was refused.

**`motion-reduce` keeps the track and the dot and stops the travel.**
Both halves. The dot rests at one end, still glowing, still in place.
Under reduced motion the two speeds collapse into one appearance, and
that is correct — *speed* is the thing being removed, so it cannot be the
only carrier. The row's note already says which state it is in.

**`aria-hidden`.** The note carries the fact in words. A screen reader
must never hear a speed.

**Only where the marker already appears.** `isActive` and the WORKING
membership decide *whether* there is a marker; this wave decides what it
looks like. Do not widen the entry condition — `activity-shows-itself`
settled it today, replacing `group === 'working'` with
`localLocked || localDirty`, and that predicate is not yours to touch.

**No third speed.** No gradient keyed to commit freshness: a scale nobody
can read (*was that four minutes or forty?*) that changes continuously is
motion in place of information.

### Done when

- **The marker aligns to the row's FIRST LINE, not its centre.** Assert a
  row carrying a stuck status line: the marker sits beside the branch
  name, not between the two lines. The pairing that matters: `top-1/2`
  looks correct on every single-line row and is wrong on exactly the rows
  carrying the most information.
- **A single-line row is unchanged.** Assert the marker's position is
  identical to today where the row has one line — the fix must not move
  the common case.
- **A row with `local_dirty` or `local_locked` travels fast; a WORKING
  row with neither travels slow.** Assert both, and that the two are
  distinguishable.
- **The dot never arrives.** Assert the animation returns to its start.
- **`motion-reduce` keeps the track and the dot and stops the travel.**
  Both halves — hiding the element under reduced motion takes the marker
  along with the movement, the rule this repo has now written four times.
- **The six grid tracks do not move.** Assert a row without the marker
  renders its columns at the same x as one with it — the marker lives in
  the left padding, not in a track.
- **`[data-live-dot]`, `[data-change-mark]` and `[data-stuck-cue]` are
  untouched.** Four marks, four meanings, and no mark implemented by
  modifying another.
- **A row can carry the marker and the whole-line flash at once**, and
  both stay legible.

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

`packages/board/src/app/components/AgentList.tsx` (`ActivityMark` and its
tests).

**Do NOT change `isActive`, the lock echo, or the contract.**

**Do NOT widen the whole-line flash** — that is wave 2
(`the-line-flashes-on-any-written-update`), which changes `watchedState`.

**`green-never-outranks-unknown` is in flight** and touches `fleet.ts`
plus a small rule in this file (the marker's transition condition). If it
lands while you work, rebase rather than race.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those; appearance
assertions (alignment, `motion-reduce`, the travel) want the browser
suite.

**The agents-tab browser suite now opens NOT STARTED's fold** via an
`expandPlans` helper that landed today — if you add a test there, follow
that idiom rather than reaching for rows that are folded away.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours:** Playwright's CDN `403`, and
`discovery.test.mjs` counting `plot-board-branch-*` in a shared
`os.tmpdir()`. Report rather than work around.

**GitHub's API has been failing with `503` all afternoon**, on both
GraphQL and REST. `gh pr view` uses GraphQL and may return **empty**
values — which are not `false`. If a push or a merge appears to fail,
**check the result** (`gh api repos/plot-pm/plot/pulls/<n> --jq .merged`)
rather than trusting the error: at least one merge today succeeded and
reported 503 anyway.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
