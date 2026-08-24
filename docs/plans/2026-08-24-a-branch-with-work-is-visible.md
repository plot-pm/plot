# A branch with work on it is visible

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The board shows a branch that carries commits, whether or not anyone has opened
a pull request for it. Work that exists is work a reader can see.

## Motivation

### The gap, measured

Asked on 2026-08-24 whether the board shows branches and PRs with no plan. It
does: `fleet.ts:4693` builds a row for every open PR no plan claims, which is
how `feature/opus5-longhorizon-hardening` (#57) and `changeset-release/main`
(#311) appear. `rowKind`'s rule is *"no plan, no wave"* — a plan-less branch
renders as `pr` or `branch`, both first-class kinds.

But the loop opens with:

```ts
const planned = new Set(rows.map((r) => r.branch));
for (const [branch, pr] of prs ?? []) {
  if (pr.state !== 'OPEN' || planned.has(branch)) continue;
```

**It iterates PRs, not branches.** A branch with commits and no open PR is in
neither collection: no plan names it, so the plan walk misses it; no PR exists,
so this loop never reaches it.

Measured against the live board the same day — 33 remote branches, 105 rows,
and **8 unmerged branches with no row at all**:

| branch | ahead | last commit | plan |
|---|---|---|---|
| `infra/the-components-leave-the-shell` | +3 | 25 hours | `the-derivations-leave-the-component` |
| `feature/the-scan-sees-a-repairable-conflict` | +2 | 6 days | `the-repair-exists-but-nothing-calls-it` |
| `bug/one-column-one-kind-of-fact` | +1 | 5 days | `a-dispatch-hands-over-a-brief` |
| `bug/the-kind-is-labelled-not-hovered` | +1 | 5 days | `a-dispatch-hands-over-a-brief` |
| `docs/opus5-hardening-plan-amendment` | +2 | 4 weeks | — |
| `worktree-plot-skills-impl` | +1 | 4 months | — |

### The finding is not the one the question expected

**Four of the six are named by a plan.** They are invisible *despite* being
planned, which means this is not "plan-less work is invisible" — it is
**work with no open PR is invisible, plan or no plan**.

That reframes the fix. A row keyed on *has a PR* answers "what is under
review?"; the board's own sections ask "what is going on?" — and three commits
pushed 25 hours ago on a planned branch is something going on.

### Why it matters more than a missing row

This is the same failure the sprint is about, one level out. `plot-dispatch.sh`
already refuses a branch whose worktree holds unlanded work, because *"a desk
somebody is sitting at is a measurement"*. The board cannot make that
measurement visible: it shows the desks with PRs open and silently omits the
rest. An operator reading the board to decide what to pick up is reading an
incomplete estate, and nothing on screen says so.

Two of the six are four weeks and four months old. Those are not in flight —
they are abandoned, and the board is the place that would have said so.

## Design

### The loop iterates branches, and a PR becomes an attribute

Today the PR *is* the row's reason for existing. Invert it: the **branch** is
the subject, and its PR — if any — is one fact about it. That is already how
planned rows work; the plan-less loop is the odd one out.

The union to walk is *branches with commits not in the default branch*, which
git answers directly:

```sh
git branch -r --no-merged origin/main
```

A branch that is merged has nothing outstanding and needs no row — that is
already the rule everywhere else, and it keeps the addition bounded: 8 rows
here, not 33.

### `state` for a branch with no PR

`wip` is the honest answer and the one the existing loop already uses for its
own rows: *the branch exists and carries work*. It also lets `classify` reach
its arms normally, rather than needing a new state nothing else understands.

### Which section it lands in

Not a new one. A branch with commits and no PR is **NOT STARTED**'s subject —
work that exists and that nobody is waiting on a machine for. If a worker is
running on it, the worker facts already move it to WORKING through the same
path every other row uses.

**It must not land in WAITING ON YOU.** Nothing is asked of the reader by a
branch someone may still be writing; putting it there would swamp the one
section whose whole value is that its rows need an answer.

### Age is the signal that makes it useful

A row saying only *this branch exists* is close to noise at 8 rows and would be
noise at 80. The fact that makes it actionable is **how long it has sat**: 25
hours reads as in flight, 4 months reads as abandoned. `ageMinutes` is already
on the row and already rendered, so this costs nothing new.

### Not chosen: a new `orphan` row kind

`RowKindSchema` has seven kinds and its docstring says adding one makes two
tables a compile error until both answer for it — deliberately. A branch with
no PR is a `branch`, which is exactly what that kind means. Nothing here needs
a new one.

### Not chosen: gate it behind a toggle

The measured count is 8. A feature that hides itself by default is one nobody
discovers, and the whole finding is that the board was quietly incomplete —
answering that with an off-by-default switch reproduces it.

## Waves

### Seen (Branch: feature/a-branch-with-work-is-seen)

The server builds a row for every unmerged branch with no open PR and no plan
row, `kind: 'branch'`, `state: 'wip'`, grouped by the existing classifier.

### Aged (Branch: feature/an-idle-branch-says-how-long)

The row states how long the branch has sat, so *in flight* and *abandoned* are
distinguishable at a glance rather than by opening each one.

## Done when

1. `git branch -r --no-merged origin/main` and the board's row set agree: every
   unmerged branch has exactly one row. Asserted against a fixture with a
   branch in each state — planned, PR-only, commits-only, merged.
2. A branch with commits and **no** PR appears, with `kind: 'branch'` and
   `state: 'wip'`.
3. A **merged** branch still produces no row. This is the assertion a naive
   implementation passes without: walking `--no-merged` is what keeps the
   addition bounded, and walking all branches would pass every other check here
   while adding 25 rows nobody wants.
4. A branch already carrying a plan row or a PR row gets **no second row**. The
   existing `planned` set is the guard; the failure mode is one branch on the
   board twice, which is the defect this sprint has fixed four times already.
5. No row from this path lands in WAITING ON YOU.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The question was better than my first two answers

Asked whether the board shows plan-less branches and PRs, I said it
*structurally could not* (wrong — the loop at 4693 exists for exactly that),
then that PR #395 would appear in WAITING ON YOU (also wrong — it was in
WAITING ON A MACHINE, `note: "PR #395, CI running"`, because CI had not
concluded). Both readings came from the source; one `curl` of `/api/fleet`
settled it.

The habit worth keeping: **query the running board before describing what it
shows.** The payload is the answer, the code is a hypothesis about the answer.

### The 8 are the ceiling, not the floor

The count is bounded by `--no-merged` and will not grow with history. It grows
with abandoned work — which is the point: a rising number here is a fleet
accumulating branches nobody finished, and that is a fact the board should
report rather than hide.
