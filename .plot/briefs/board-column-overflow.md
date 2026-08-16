## Implementation brief — board-becomes-operable (wave 2: Density)

- **Plan (canonical):** `docs/plans/2026-08-16-board-becomes-operable.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #146 merged (two interrogation rounds)
- **Branch:** `feature/board-column-overflow` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`board-story-overlay`) merged as #151. Wave 3
(`board-approve-affordance`) is **not yours** and is held back deliberately.

### What to build

A board column past a threshold renders its **most recent** cards plus a control
for the remainder. `Released` holds thirteen today and only ever grows; every
one of those was worth seeing once, none is worth scrolling past forever.

Not a scrollbar — that hides the count. Not a hard cut — that hides the work.

**Recency is by the phase's own date**, not by file order: `Released` sorts by
the release date, `Endgame` by delivery. A column that claims to show "the
latest five" and shows five arbitrary ones is worse than showing all thirteen.

**The count is always visible.** `Released (13)` with five shown states plainly
that eight are hidden; five cards with no number reads as *there are five*.

**It applies to any column past the threshold**, not to `Released` alone.
`Endgame` reaches it next, and a rule with one hard-coded exception is a rule
someone has to remember.

### The threshold is yours to measure

The plan deliberately does **not** name a number. The right one depends on how
tall a column gets before it stops being scannable, which is a question for a
browser and not for a plan file. Pick it against the real columns, and justify
it in the PR.

Writing a number into the plan would have been a guess wearing the authority of
a decision — the same mistake a sibling plan made by naming a port before
checking how one was chosen.

### Related work you should read first

[`working-rows-show-motion`](../../docs/plans/2026-08-16-working-rows-show-motion.md)
collapses the Agents tab's `quiet` and `done` groups, and is in flight now on a
different component. Same instinct — long lists must not cost the space live
work needs — so **read how it words "how many are hidden" and match it** rather
than inventing a second vocabulary for the same idea.

That plan also settles a rule worth borrowing: it never collapses automatically
while the view is being read, because a page that moves its own furniture under
the cursor is worse than a long one.

### Done when

The plan's `## Done when` list is the specification. Two assertions exist
because a naive test passes without them:

- **A column past the threshold shows the most recent cards and says how many
  are hidden.** Assert the count is present — five cards with no number is the
  exact failure this is meant to prevent.
- **Recency uses the phase's own date.** Assert against a fixture whose file
  order and date order **disagree**; otherwise the test passes on a coincidence.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — this repo has repeatedly lost sight of finished work that was
never pushed, three times on one branch today.

### Scope guard

`packages/board/src/app/components/Board.tsx`, `PlanCard.tsx` if a card needs
it, and their tests.

Do **not** implement the Approve button — that is wave 3.

One other branch is in flight: `feature/agent-groups-collapse` holds
`AgentList.tsx` and the row sort in `fleet.ts`. No overlap with yours.

`.gitattributes` marks the built artifact `-merge`, so a conflict there is
expected and harmless: take either side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — and expect it, because every board merge
invalidates every open board branch's artifact.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
