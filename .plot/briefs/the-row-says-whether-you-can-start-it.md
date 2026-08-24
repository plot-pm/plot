## Implementation brief — the-row-says-whether-you-can-start-it (wave: Answered)

- **Plan (canonical):** `docs/plans/2026-08-23-the-row-says-whether-you-can-start-it.md` on main
- **Approved:** 2026-08-24, in-session, after **five** interrogation rounds
- **Branch:** `bug/the-row-says-whether-you-can-start-it` (base: `main`)
- **Ends as:** one PR to `main`

The plan's `## Done when` has **15 items** and is the specification. Read it.
This brief carries only the decisions that were settled during interrogation and
must NOT be re-derived.

### What to build

A row states **whether you can start it**, in one of four words, and `eligible`
stops being what a row displays:

| word | when |
|---|---|
| `start work` | prior waves landed, plan approved, not claimed, brief exists |
| `needs a brief` | otherwise startable, but no brief |
| `waiting on approval` | the plan is not approved |
| `someone is on it` | `wip` or `claimed` |

Measured: **26 rows say `eligible` and ~5 can actually be started.**

### Settled — do not re-derive

**Computed in `classify`.** It already receives plan phase, branch state, worker
and claim, and already returns a derived triple. The verdict joins it, so it
travels with the `group` it must stay consistent with. Anywhere else is a second
traversal and a row that could say `start work` while sitting in
`waiting-on-you`.

**The brief is read from the row's existing `brief` field, never the
filesystem.** 79 branches on a 5 s pulse would be ~57,000 `stat` calls an hour.

**An absent verdict renders NOTHING.** The board CASTS the payload rather than
parsing it, so a Zod `.default` never fires client-side and an older server's
omission arrives as `undefined`. Falling back to `eligible` was rejected: it
would keep the removed word alive on every un-upgraded server.

**`merged` gets no startability verdict at all** — finished work is not someone
working. `wip` and `claimed` share one word; both mean *not yours*.

**`isStartable` becomes a READ of the verdict**, not a second computation. Two
predicates answering *can I start this* is how a row promises an action the menu
then refuses.

**`start work` IS coloured, and this OVERRIDES `waitingTone`.** That function
says giving `click` a colour would "make the section shout twice and mean once".
The operator overrode it, following `an-eligible-wave-takes-the-actionable-tone`.
**Update `waitingTone`'s docstring** — an overridden rule that still reads as
current is how the next reader reverts the change.

**The scan keeps `eligible`.** `plot-fleet-scan.sh` is unchanged; only the
board's word changes. But assert they do not drift: a branch the row calls
`start work` is one `--next` would hand out.

### Done when

The plan's 15-item list. Note especially: prove with **fixtures, one per
verdict, plus exhaustiveness** — not against the live estate, whose counts moved
from 25/8 to 26/5 while the plan was being written.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Waves` section on
main once the PR exists. Add a changeset (`'@plot-pm/board': patch`). Run
`pnpm build:board` in THIS worktree and commit the artifact.

### Scope guard

`packages/board/src/**` and its tests. `the-fleet-knows-its-sprints` (#379) just
merged into `schema.ts` and `fleet.ts` — merge `origin/main` first so you are
building on it rather than colliding with it.
