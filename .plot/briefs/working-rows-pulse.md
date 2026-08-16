## Implementation brief — working-rows-show-motion (wave 1: Motion)

- **Plan (canonical):** `docs/plans/2026-08-16-working-rows-show-motion.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #145 merged (two interrogation rounds)
- **Branch:** `feature/working-rows-pulse` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

The sibling wave `feature/agent-groups-collapse` is **not yours** and is held
back deliberately: it edits the same component, and this repo has paid three
times in one day for two agents in one file. It rebases onto your work.

### What to build

A small pulsing dot before each `working` row. That is the whole change: one
element, one utility class.

The Agents tab exists to show work in flight and renders like a table of
records — a branch an agent is editing right now looks exactly like one nobody
has touched for 22 days. This is the board's **first animation**; there is no
existing convention, so keep the introduction as small as possible.

**Use Tailwind's `animate-pulse` with `motion-reduce:animate-none`.** No new CSS
file, no hand-written keyframe — and the reduced-motion variant comes with the
utility rather than needing its own media query.

### Four decisions the plan settles — do not re-derive them

**One animation for the whole group, not graded by confidence.** `WORKING` has
three entrances of differing strength (`uncommitted work in a local worktree`,
`last commit 3 min ago`, `claimed, no commits yet`). Grading the animation by
which one applied is tempting and rejected: **group membership is the
statement**, and it is true for all three. The note already says which reason,
so speeds would encode what the text states plainly — and speed is unreadable in
isolation and invisible in a screenshot.

**A pulse, not a spinner.** `WORKING` regularly holds several rows — four agents
ran in parallel the evening this was written — and four rotating spinners in a
column is flicker, not information. Rotation also implies *progress toward
completion*, which nothing here measures; a pulse implies *aliveness*, which is
the claim being made.

**Before the row, not inside the note.** The note is where the row states its
facts, and motion there competes with reading them. A leading dot needs no
column of its own and scales from one row to eight.

**The dot is decorative: `aria-hidden`.** A screen reader already gets the group
heading and the row's own text. The animation must never be the only carrier of
a fact — the rule the contract sets for colour, applied here by design.

### What this animation claims, and what it must not

A moving indicator is a claim, and the honest version is narrow. The board polls
git every 5 seconds; it does not watch an agent. A pulse on a `WORKING` row
asserts only **that the row is in `WORKING`** — true by construction and
re-derived every scan. It stops when the row leaves the group, which is exactly
when the work stopped or moved on.

This is deliberately unlike the countdown that kept ticking after its server
died (fixed in `board-tells-the-truth`): that asserted a *specific future event*
("next in 0s") which was not coming.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because a naive test passes without them:

- **All three `working` notes get the same indicator** — assert
  `uncommitted work…`, `last commit…` and `claimed, no commits yet` render
  identically; a confidence-graded implementation passes a test checking only
  one.
- **Rows in every other group stay still** — assert the negative, including a
  `quiet` row that also has a recent claim.
- **The indicator disappears when the row leaves the group** — assert across a
  state change, not on a static fixture.
- **`prefers-reduced-motion: reduce` disables the animation and the dot stays
  visible** — assert both halves; removing the element would lose the marker
  along with the motion.
- **The row is fully legible with animation off** — group, note and age
  unchanged.
- **An empty `WORKING` group animates nothing** — trivial by construction, but
  assert it so nobody later moves the animation to the group header.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — this repo has repeatedly lost sight of finished work that was
never pushed.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` and its tests.

Do **not** implement the collapsible sections — that is the sibling wave.

`.gitattributes` marks the built artifact `-merge`, so a conflict there is
expected and harmless: take either side, run `pnpm build:board`, `git add` it,
continue. Do not read that diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
