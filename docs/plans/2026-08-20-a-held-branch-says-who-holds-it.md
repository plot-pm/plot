# A held branch says who holds it

> The board reported `WORKING: none — nothing to do, just look` while four
> agents were editing files in four worktrees, and offered three of their
> branches as *"eligible — nobody has taken it"*. Neither half is stale data:
> both are correct readings of the wrong evidence. `WORKING` infers activity
> from an uncommitted diff, `NOT STARTED` infers freedom from an absent claim
> ref, and a branch held by an agent that committed satisfies both.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — the board reported `WORKING: none` while four agents worked; finding 1+2 already fixed in #258
- **Delivered:** 2026-08-22, jwloka, PRs #260, #261, #266, #269, #274
- **Released:** 2026-08-22, v2.7.0
- **Started:** 2026-08-20, Jan Wloka, `feature/a-worktree-holds-its-branch`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-board-says-who-holds-a-branch`

## Problem

Observed 2026-08-20 on a fresh board (`scanned 5s ago`, artifact rebuilt at
03:09), with four in-session agents live in four worktrees:

| Worktree | dirty | ahead | Board's verdict |
|---|---|---|---|
| `reconcile-advisory` | 0 | 1 | *eligible — nobody has taken it* |
| `row-verdict` | 0 | 1 | *eligible — nobody has taken it* |
| `no-ref-join` | 0 | 1 | not shown at all |
| `design-is-a-phase` | 2 | 0 | not shown at all |

**`WORKING` read `(1)` in one screenshot and `none` in the next**, and the only
thing that changed between them was `row-verdict` committing its work
(`75ea4758`, 744 insertions). Finishing the work removed the row.

### Two proxies for one missing fact

The fact nobody records is **who holds this branch**. Two consumers guess it
from different evidence, and each is wrong in a different direction:

- `WORKING` uses *the worktree has uncommitted changes*. That signal is
  inverted with respect to progress: brightest when least has been achieved,
  dark the moment a commit lands. An agent that commits and keeps working
  vanishes.
- `NOT STARTED` uses *`refs/plot/claims/<branch>` is absent*. True whenever the
  worktree was created by hand rather than by `plot-dispatch.sh`, which pushes
  the claim as its first act.

So the board can simultaneously assert that nobody is working and that finished,
green work is available to start. It did.

### The branch row cannot be clicked, because it carries no link

Measured from `/api/board` on the same pulse: a **plan** row carries
`slug, title, type, phase, path, prs, phaseDate, story, waveSummary`. A
**branch** row carries `branch, path` — and nothing else. Zero of the seven
branch rows in the payload hold a `pr` field or any URL field.

So the plan name is a link and the branch name beside it is inert text. This is
not a styling omission the UI could correct: the data is absent from the
contract, and the board's own `WAITING ON YOU` section proves the fix is cheap,
because the PR-bearing rows there render `#240` and `#57` as links already. The
same PR number is reachable per branch — `plot-plan-meta.sh` reports `prs` per
plan and the fleet scan resolves each branch's PR to decide `merged` — it simply
is not carried onto the row that displays the branch.

### One action sits outside the menu it belongs in

Observed 2026-08-20. Every row action reaches the reader through the `...`
menu — except *Create plan* on an issue row, which `CreatePlanButton.tsx`
renders inline as text. Two consequences, both visible in the same screenshot:

- **It collides with the age column.** The issue rows read `1d` and `Create
  plan` overlapping in the same cell, because a fixed-width age track was never
  asked to share with a button.
- **The reader learns two grammars.** Actions are in the menu, *except this
  one*. A row's affordances should be discoverable in one place, and an
  exception has to earn itself — this one is an artefact of the button arriving
  before the menu existed, not a decision.

The menu already carries actions that write to the host, so *Create plan* is
not too consequential for it. The two-step arm (`Create plan — Draft for #228?`)
is worth keeping wherever it lives; that confirmation is about the write, not
about the placement.

### The same gap, in dispatch

`plot-dispatch.sh --dry-run` reported `claimed=0` across a fleet with four live
agents, and offered `feature/the-row-carries-its-verdict` and
`feature/reconcile-calls-the-index-advisory` — both already implemented and
tested — as dispatchable. Acting on that output puts a second agent on finished
work.

Notably the same script **already reads worktrees**: its "in flight: `<branch>`
holds `<files>`" section enumerates local refs and worktrees to predict
collisions, and correctly listed 40 branches. It can see what a branch *touches*
and not that someone is *holding* it, because the two facts come from different
sources.

### Why a rule will not fix it

"Always dispatch through `plot-dispatch.sh` so the claim exists" is a rule, and
it was violated four times in one evening by an operator who had read it that
same evening. The check *"did I claim this?"* is answerable without doing it.

## Design

### A live worktree is evidence, and it is already collected

A branch is held when a worktree has it checked out and its tip is not merged.
That is observable from `git worktree list` plus the ancestry the scan already
computes — no new state, no file, nothing to keep in sync. It is a derivation,
which is what the fleet scan is allowed to be.

The claim ref stays the primary signal: it is the only one that crosses machines,
and a detached worker on another host has no worktree here. Worktree evidence is
**additive** — it can only move a branch from *free* to *held*, never the reverse.

### What each consumer should say

| Consumer | Today | Should be |
|---|---|---|
| `WORKING` | dirty tree only | a worktree holding an unmerged branch, committed or not |
| `NOT STARTED` | *eligible — nobody has taken it* | *held in a local worktree* where one exists |
| `plot-dispatch.sh` | offers the branch | **refuses it**, naming the worktree path |

The dispatch row is the gate: a refusal an agent cannot rationalise past, unlike
a warning it may read as advisory.

### What this must not do

- **Not claim on the operator's behalf.** Writing a claim ref for a worktree the
  script did not create would put a record in git for something nobody asked to
  record, and a stale ref is worse than an absent one.
- **Not treat a clean worktree with a merged tip as held.** That is a leftover
  directory, and there are several on this machine.
- **Not read process state.** `plot-worker-state.sh` answers "is a worker running
  here" for dispatched workers; an in-session agent has no marker file and never
  will. The worktree is the durable fact; the process is not.

### Open Points

- [ ] Does a dirty worktree on a **merged** branch mean anything worth showing?
      Probably local scratch work, but it is the one case where "held" and
      "abandoned" look identical.
- [ ] The banner keeps a failed scan's error after a later scan succeeds — the
      board said `timed out after 30000ms` above a footer reading `scanned 5s
      ago`. Same screen, separate defect; may belong in
      `the-board-renders-what-has-arrived`.

## Branches

### Held
- `feature/a-worktree-holds-its-branch` — the fleet scan reports a branch as held when a worktree has it checked out with an unmerged tip, alongside the claim ref rather than instead of it. Tests: a committed-and-clean worktree reads held; a dirty worktree reads held; a clean worktree on a merged branch does not; a claim ref with no worktree still reads claimed; the branch's wave eligibility is unchanged by holding. → #266

### Said
- `bug/the-board-says-who-holds-a-branch` — `WORKING` shows a held branch whether or not its tree is dirty, and `NOT STARTED` says *held in a local worktree* instead of *nobody has taken it*. Tests: an agent that commits stays in WORKING; a held branch is never offered as eligible; the row names the worktree. → #274
- `bug/a-branch-row-carries-its-link` — the branch row carries the PR number and URL the scan already resolved, so the branch name links the way the plan name does. Tests: a branch with a merged PR carries its number; a branch with no PR carries none and renders as text rather than a dead link; the row's link survives a branch whose ref is deleted, since the PR outlives it. → #260
- `bug/every-action-is-in-the-menu` — *Create plan* moves into the `...` menu with every other row action, freeing the age column it currently overlaps. Tests: an issue row's menu offers Create plan; no action renders outside the menu; the two-step arm survives the move; the age column renders alone. → #269
- `bug/dispatch-refuses-a-held-branch` — `plot-dispatch.sh` refuses a branch whose worktree exists with an unmerged tip, naming the path, and says so in `--dry-run`. Tests: a held branch is refused and counted `skipped`; the refusal names the worktree; `--allow-local` does not override it; a leftover worktree on a merged branch is still dispatchable. → #261

## Notes

Found by an operator looking at the board rather than by any test: the fleet's
own instrument reported the fleet idle while four agents worked in it.

The evening's other correction rhymes with this one. `the-no-ref-arm-asks-once-too`
assumed `refs=0` meant *merged* when it also means *never pushed* — one git shape,
two opposite causes. Here a clean worktree means *finished* or *never started*,
and the board picked the wrong one. Both are the same mistake: reading a single
observable as though it had a single cause.
