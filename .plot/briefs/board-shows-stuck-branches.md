## Implementation brief — board-watches-for-stuck-branches, wave 2 (Display)

- **Plan (canonical):** `docs/plans/2026-08-17-board-watches-for-stuck-branches.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #181 merged (one interrogation round)
- **Branch:** `feature/board-shows-stuck-branches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

A stuck branch **says so in its row**, names which of the four states it
is in, carries the evidence, and — for the three the pulse cannot fix —
**offers its action on the row with an animated cue**.

### The measurement

Wave 1 (#183) landed the detection and the carrier. Measured on `main`
just now:

| | |
|---|---|
| `StuckSchema` on the row | present — `stuck: StuckSchema.nullable().default(null)` |
| Detection producing states | present — `conflict`, `artifact-conflict`, `ci-failing`, `unpushed` |
| **`AgentList.tsx` rendering any of it** | **zero occurrences of `stuck`** |

So the facts reach the row and stop. That is this wave's whole job.

The contract states the rule this display must honour, and it is worth
quoting because it is easy to violate while looking correct:

> *EVIDENCE TRAVELS WITH THE STATE, always. A row that says* stuck *and
> makes the reader go find out why has moved the ten minutes of
> log-reading rather than removed it.*

### Six decisions the plan settles — do not re-derive them

**The action goes ON THE ROW, not in the three-dot menu.** Measured, and
this is why the rule exists: `RowActions` hides its action behind the
menu, and the menu opens only if something inside could act — so a row
with a waiting action looks identical to a row with none until you click
it. A cue nobody finds is not a cue.

**The cue animates**, and this is the one place on this board where
motion is right. #180 settled the opposite for a neighbouring case — *a
thing true for hours has less claim on motion than a thing true for three
seconds* — which is why `activity-shows-itself`'s bar is static. A stuck
branch is neither: it is **true until someone acts**, and the acting is
the point. Motion here marks an **unanswered request**, not a state.

Bounded so it cannot become wallpaper:

- **Only on rows with an offered action.** `unpushed` is reported in
  words — the fix is a push, and pushing someone else's work is not ours.
- **`artifact-conflict` offers nothing** — wave 3 resolves it. Until wave
  3 exists it is reported like any other state, with no action.
- **It stops when the action is TAKEN**, not when the branch unsticks.
  The request has been answered; whether the answer worked is what the
  row's other marks report.
- **`motion-reduce` keeps the cue and stops the animation.** Both halves.
- **Never motion alone and never colour alone** — the action carries a
  word, the reason reaches the accessible name, the animation is
  `aria-hidden`.
- **A healthy row carries no cue.** A cue on every row makes the stuck
  ones invisible.

**A CI failure shows evidence, never a verdict.** Render the failing
check names, the branch's changed paths, and its recent run history:

```
CI failed — step: Install Playwright browser
this branch changes only .md
same branch passed at 10:17, failed at 10:19
```

Do **not** classify it as foreign or transient. Nothing maps a failing
step to a changed path; that table is unmaintained by construction.

**Over a non-localhost binding the cue SHOWS and the action REFUSES,
naming the reason.** `/api/dispatch` is localhost-only — *"whoever
reaches localhost:7777 is sitting at the machine that owns the
worktrees"* — so over Tailscale the board is a reading surface. The
information is true everywhere; hiding the cue would let a phone report a
healthy fleet while branches sit stuck. `RowActions` already does exactly
this when the server will not act; follow it.

**A stuck branch keeps its group.** The contract says so: *"a stuck
branch keeps the group it belongs to and gains this beside it."* Do not
move rows, do not add a section.

**`null` is the common case.** Most rows are not stuck; the row must
render exactly as it does today when `stuck` is `null`.

### Done when

- **Each of the four states is visibly distinct**, and named. Assert all
  four.
- **The evidence renders with the state.** Assert a `conflict` row shows
  its conflicting paths, a `ci-failing` row shows failing checks, changed
  paths and run history, and an `unpushed` row shows its commit count.
  The pairing that matters: a row that says *stuck* without its evidence
  moves the ten minutes of log-reading rather than removing it.
- **The action is reachable WITHOUT opening the three-dot menu.** Assert
  it is present on the row itself.
- **The cue animates, and `motion-reduce` keeps it while stopping the
  animation.** Both halves — hiding it under `motion-reduce` takes the
  marker along with the movement.
- **`unpushed` carries no cue and no action**, only words.
- **`artifact-conflict` carries no action** in this wave.
- **The cue clears when the action is taken**, not when the branch
  unsticks.
- **A row with `stuck: null` renders exactly as before.** Assert against
  the existing row tests — most rows are not stuck, and this must cost
  them nothing.
- **Over a non-localhost binding the cue shows and the action refuses,
  naming the reason.** Assert both halves.
- **A stuck row keeps its group.** Assert it is not moved or re-sectioned.
- **`[data-change-mark]`, `[data-live-dot]` and the activity mark are
  untouched.** Assert all three render as before — #180 ships the
  precedent (*"leaves the LIVE DOT alone — two marks, two meanings"*) and
  no mark may be implemented by modifying another.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check you are on `main` before
making that edit** — an agent today committed plan bookkeeping onto
another agent's branch by not checking.

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase** — a rebase left unpushed reads from
outside exactly like an agent that stopped, and cost PR #177 half an hour
of dead CI today.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` and its tests.

**Do NOT build the resolver** (wave 3) and do NOT add any write path.
This wave renders and offers; the only automatic write this plan ever
grants is wave 3's, and it is fenced by an argument this wave must not
weaken.

**Do NOT touch the detection or the contract** — wave 1 (#183) settled
both; you consume them.

**Do NOT touch `classify()` or the grouping.**

**`activity-shows-itself` wave 2 (`feature/activity-marker-glows`) is
eligible in the same file.** It is not dispatched yet, but if it lands
while you work, rebase rather than race, and do not touch its marks.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom, no React Testing
Library. Recent waves put their decisions in **exported pure functions**
and asserted those, using browser tests only for what genuinely needs a
page. The state-to-appearance mapping reduces to a function; the
`motion-reduce`, `aria-hidden` and non-localhost assertions want a page.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours, do not "fix" them:**
1. Playwright's CDN has returned `403 — this service is not available in
   your location` while installing a browser.
2. `discovery.test.mjs` counts `plot-board-branch-*` in a **shared**
   `os.tmpdir()`, so a concurrent board process moves the count; CI has
   also seen `ENOTEMPTY` tearing down its temp `.git`. A recorded finding
   awaiting its own plan.

If CI fails in something you did not touch, verify locally and **report
it** rather than working around it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
