## Implementation brief — board-becomes-operable, wave 3 (Action)

- **Plan (canonical):** `docs/plans/2026-08-16-board-becomes-operable.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #146 merged
- **Branch:** `feature/board-approve-affordance` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

A Draft plan card gains an **Approve** button that runs `/plot-approve <slug>`
through the board's API. This is the last of three waves — Navigation (#151) and
Density (#155) are merged — and the only one that **acts**.

### Six decisions the plan settles — do not re-derive them

**Approve acts; it does not copy a command.** An earlier draft had the button
merely show and copy `/plot-approve <slug>`, on the grounds that under
`Review: pr` the command **merges the plan PR** — writing to the git host,
undoable only by more git — while `Start work`, the board's one other acting
control, only creates a worktree and pushes a claim, where a wrong click costs a
`git worktree remove`.

That asymmetry is real and was still rejected, for two reasons worth keeping:
the same irreversibility exists when the command is typed in a terminal, where
*nothing* confirms anything, and it gets typed by rote — eight plans were
approved in one evening through the identical sequence. And a copy-a-command
affordance would put a second action vocabulary on a surface that has exactly
one: two buttons side by side, one acting and one merely offering text,
indistinguishable by looking.

**One confirmation, inside the button.** First click turns `Approve` into
`Approve — merges PR #<n>?`; second click runs it; a click elsewhere cancels.
No dialog, no modal above a modal, no new pattern. The second label must name
the **consequence**, not repeat the verb — that is the part a reader needs
before committing. A single-click implementation passes every test that only
checks the end result, which is why the plan asserts the first click separately.

**It goes through the same door as `Start work`.** `/api/dispatch` spawns
`plot-dispatch.sh` detached and logs it, behind a localhost check, a same-origin
check and slug validation. Approve gets the same treatment for `plot-approve`.
One way for the board to invoke Plot — the approval rules stay in the skill and
are not reimplemented beside it. Read `packages/board/src/server/dispatch.ts`
and follow its shape rather than inventing a second one.

**A failure shows the script's own words on the card.** `/plot-approve` already
explains itself — *"Plan is still a draft. Mark it ready for review first."*, a
closed PR, a rejected push. Surfacing that text beats replacing it with
"failed": a failure without a reason sends the reader to a terminal, and then
the command could have been typed there in the first place.

**The button appears on EVERY Draft card**, including plans whose PR is not yet
marked ready — a state that occurred repeatedly in one evening. Hiding it there
would make the board know Approve's preconditions and keep them in step with the
skill, putting the same rule in two places. Let the script refuse and show its
reason; that is what the previous decision is for.

**It appears ONLY on Draft cards.** An approved plan has nothing to approve, and
offering it invites a second approval whose only effect is a confusing error.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **Approve appears only on Draft cards** — and on Draft cards whose PR is *not
  yet ready*. Assert the second case explicitly: an implementation that hides
  the button there has quietly copied Approve's preconditions into the board.
- **The first click does not approve.** Assert one click makes **no request**
  and changes the label — not merely that the end result is right.
- **The second click posts to the API**, not to the git host directly.
- **A failing approval shows the script's own message**, not a generic
  "failed" — the reason is the whole value of surfacing it.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists** — this repo lost sight of finished work three times on one branch in a
single day because it was never pushed.

### Scope guard

`PlanCard.tsx`, a new API route beside `/api/dispatch`, the contract field it
needs, and their tests.

**One other branch is in flight and it overlaps you.**
`feature/board-dims-when-lost` holds `App.tsx`, `StartWorkButton.tsx`,
`UnreachableOverlay.tsx`, `schema.ts`, `board.ts`, `index.ts` and
`server-info.ts`. Two of those are yours by necessity — **`schema.ts` for the
contract field and `board.ts`/`index.ts` for the route**. Keep both additions
narrow and rebase rather than race; do not restructure anything you find there.

`StartWorkButton.tsx` is the pattern to **read** and not to edit — it is that
branch's file right now.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — and expect the conflict, because every
board merge invalidates every open board branch's artifact. Which side you take
genuinely cannot matter: the rebuild overwrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
