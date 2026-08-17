## Implementation brief — activity-shows-itself, wave 2 (Prominence)

- **Plan (canonical):** `docs/plans/2026-08-17-activity-shows-itself.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #179 merged (two interrogation rounds)
- **Branch:** `feature/activity-marker-glows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The activity marker becomes a **glowing bar on the row's left edge** —
prominent enough to spot from across the board, and **static**.

Wave 1 (#182) landed `isActive` and rendered `[data-activity-mark]`
minimally. This wave changes only its appearance. Wave 3 (the group
heading) and wave 4 (the unpushed mark) are **not yours**.

### The measurement

Reported: *can the activity indication be more prominent — pulsing,
moving, with a glow?* The measurement redirected two-thirds of it.

**The dot was not too quiet; it was uninformed.** `isLive` is
`group === 'working'` and nothing more — a row sits there for hours while
an agent works, has crashed, or waits on a human. Wave 1 fixed that:
`isActive` now reads `localLocked || localDirty`, so there is finally
something true to make loud.

**But it must not pulse, and the count has gone UP since the plan was
written.** Measured on `main` just now: **four** animated elements exist
on a row —

| Selector | Animation | Means |
|---|---|---|
| `[data-live-dot]` | `animate-pulse` | in the WORKING group (hours) |
| `[data-change-mark]` | `animate-pulse` | PR state just changed (~3 s) |
| `[data-stuck-cue]` | `animate-ping` | an unanswered request |
| *(the change-mark's dark variant)* | | |

The plan settled this when there were two; there are now four, so the
argument is stronger rather than weaker. **A fifth at a fifth scale
competes rather than adds.**

The ordering principle, in the words the plan took from #180: **a fact
true for hours has less claim on motion than a fact true for three
seconds.** Motion is the scarce channel and the transient marks hold it.
Activity is persistent by nature — someone is writing, and will be for a
while — so it takes **presence**: a bar that is simply there, with the
glow supplying the prominence, and its appearance and disappearance
carrying the change.

### Five decisions the plan settles — do not re-derive them

**A bar on the left edge, not a bigger dot.** The reported problem is
spotting it *from a distance*: a vertical stroke at a fixed x reads as a
mark down the side of the list, where a dot must be hunted. It also
scales to wave 3 — a heading can carry the same stroke; a dot in a
heading would read as a bullet.

**Emerald, glowing, static.** The glow is what carries the prominence the
requested motion was meant to carry. No `animate-*` of any kind.

**It keeps its left-padding home.** Wave 1's mark hangs beside `LiveDot`
in the row's left padding via `sm:absolute`, deliberately outside the six
grid tracks so the columns do not move to make room for something most
rows never carry. Keep that.

**`motion-reduce` leaves it unchanged, because nothing animates — and
the glow must survive it.** A reduced-motion rule that strips the glow
would take the distinction between this mark and wave 4's with it.

**`aria-hidden`, and the `title` keeps its limit.** Wave 1 set
*"A write is in progress in this checkout"* — the local-only limit
measured at `fleet.ts:702`: these signals are *"true only on the machine
doing the looking"*. An agent on another machine produces no mark, and
that absence means **not visible from here**, never *not happening*. Do
not drop or weaken that sentence.

### Done when

- **The activity mark is a glowing bar on the left edge**, and reads
  distinctly from `[data-live-dot]` beside it.
- **It does not animate.** Assert no `animate-*` on it. The pairing that
  matters: an implementation reaching for `animate-pulse` because the
  board uses it elsewhere passes every visibility assertion and makes a
  row with four other moving things noisier, not clearer.
- **`motion-reduce` leaves the mark and its glow intact.** Assert both —
  a rule that strips the glow removes the carrier wave 4 will contrast
  against.
- **The six grid tracks do not move.** Assert a row without the mark
  renders its columns at the same x as one with it — the mark lives in
  the left padding, not in a track.
- **`[data-live-dot]`, `[data-change-mark]` and `[data-stuck-cue]` are
  untouched.** Assert all three render exactly as before. Four marks,
  four meanings, and no mark implemented by modifying another — #180
  ships the precedent (*"leaves the LIVE DOT alone — two marks, two
  meanings"*).
- **A row can carry several marks at once and does.** Assert a WORKING
  row that is dirty, whose PR just changed, and which is stuck shows all
  of them, distinctly.
- **The `title` still names the local-only limit.**
- **`isActive` is unchanged.** Wave 1 settled the predicate; you change
  only how its answer looks.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check `git branch
--show-current` is `main` before that edit** — an agent today committed
plan bookkeeping onto another agent's branch by not checking.

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the mark's
appearance) and its tests.

**Do NOT change `isActive`, the lock echo, or the contract** — wave 1
settled all three.

**Do NOT build the group heading** (wave 3) or the unpushed mark
(wave 4).

**Do NOT touch the stuck row, its cue, or the resolver** — all landed in
#185/#186 today.

**`not-started-says-what-it-waits-for` is eligible in the same file** but
is not dispatched. If it lands while you work, rebase rather than race.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those, using
browser tests only for what needs a page. Appearance assertions
(`motion-reduce`, the glow, track alignment) want the browser suite.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours, do not "fix" them:**
1. Playwright's CDN has returned `403 — this service is not available in
   your location` while installing a browser.
2. `discovery.test.mjs` counts `plot-board-branch-*` in a **shared**
   `os.tmpdir()`; CI has also seen `ENOTEMPTY` tearing down its temp
   `.git`. A recorded finding awaiting its own plan.

**GitHub's API returned `503` repeatedly this afternoon.** If a push or a
merge fails that way, retry rather than concluding anything about the
code.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
