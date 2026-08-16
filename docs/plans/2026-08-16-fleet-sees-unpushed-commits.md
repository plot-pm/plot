# A finished commit nobody pushed is not "no commits yet"

> `fleet-sees-local-work` taught the scan to notice a *dirty* worktree. A worker
> that commits and pauses before pushing leaves a clean one — and falls back
> into the same blindness one layer down.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Not hypothetical, and not reconstructed: it happened on 2026-08-16 on the very
branch that fixed the neighbouring half.

An agent implementing `fleet-sees-local-work` finished its work on
`bug/fleet-sees-local-work` and stopped before pushing. Measured at that moment:

| | |
|---|---|
| Local HEAD | 3 commits ahead of `origin/main` |
| Dirty files | **0** |
| Remote ref | the claim commit only |
| PR | none |

The board read **"claimed, no commits yet"** for a branch holding a complete
implementation — including the commit titled *"a dirty local worktree lifts a
branch out of quiet"*, the fix for the other half of this blindness.

**`local_dirty` cannot answer this case, by construction.** It reports
uncommitted changes; committing clears it. So the moment a worker finishes
tidily, the signal that was covering for it disappears:

```
work in progress   → dirty=true  → lifted out of quiet   ✅ (shipped)
work finished, unpushed → dirty=false → "no commits yet"  ❌ (this plan)
```

The gap is worse than the one already fixed, because it opens **exactly when
the work is most complete** — and complete-but-unpushed work is also work with
no backup and nothing for a merge-queue check to inspect. On 2026-08-16 it also
blocked a dispatch: `agent-view-phase` could not start while the collision it
had to avoid existed only on one machine's disk.

## Design

### `local_ahead` — commits this machine has that the remote does not

**It is a ref question, not a worktree question** — and getting that wrong was
the first draft's mistake. `local_dirty` had to go through the worktree list
because dirtiness is a property of a *working directory*: only the checkout
knows whether files were edited. Aheadness is not. Measured: worktrees share
one ref database, so from the main repo

```sh
git rev-parse refs/heads/bug/board-shows-staleness   # → f0f959c
```

answers for a branch checked out in a *different* worktree. So the comparison
is between two refs and needs no `git -C` at all:

```sh
out=$(git rev-list --count "refs/remotes/origin/$br..refs/heads/$br" 2>/dev/null); rc=$?
```

Measured at **5.2 ms** per call from the main repo (20 iterations, 0.104 s),
against the 6.6 ms per worktree the shipped scan already accepts.

Binding it to the worktree list would have been *consistent* with `local_dirty`
and wrong: a local branch with no worktree — checked out once and moved away
from, or fetched from a colleague — still holds commits nobody else can see,
and the worktree-shaped version would silently skip exactly those. Two signals
that answer different questions read from the sources that actually hold the
answers.

**Over the branches the plans name, as today.** The scan is a *fleet* view, not
a branch listing — a deliberate decision from earlier plans, and #136 chose
carefully which unplanned branches earn a row (those with an open PR) rather
than showing all of them. `local_ahead` answers *this planned work is
invisible*, not *show me every local branch*, so its cost stays proportional to
the plan rather than to the checkout.

**Ahead only; divergence is not this plan's question.** `rev-list --count A..B`
counts one direction, and that is the right one. The question is *does work
exist here that nobody else can see*, and unpushed commits are exactly that
whether or not the branch also trails the remote. Being *behind* is not an
invisible state — it is sitting in the remote for anyone to read — and
reporting it would answer a second question with no action attached.

**It obeys the same five rules, unchanged** — which is the argument for adding
it here rather than designing something new:

**Absent is not false.** A machine with no worktree for a branch answers from
refs exactly as today. The signal may only *add* an answer where this machine
knows more.

**One-directional.** Like `local_dirty`, it may lift a branch out of quiet and
may never downgrade a group. A branch with an open PR still answers about its
PR.

**Read the exit code, not the emptiness.** Measured: a missing upstream exits
**128 with empty output** — bit-identical to the deleted-worktree signature the
existing code already handles. Empty output must not read as "zero ahead", for
exactly the reason empty `git status` output must not read as "clean". This
reuses a rule already argued rather than inventing one.

**No cap.** Measured: **5.2 ms** per call from the main repo (20 iterations),
against the 6.6 ms per worktree the shipped scan already accepts. Twenty
branches cost ≈104 ms on a scan that runs 500–1050 ms, and the count follows
the plans rather than the checkout. A cap would be stock against a problem the
numbers rule out — and caps drop results silently unless they also report
saturation.

**Dirty and ahead are different facts, and the row says both.** A branch can be
either, both, or neither. `local_dirty` means *someone is editing*;
`local_ahead` means *finished work exists that nobody else can see*. Where both
hold, the row names both, unpushed first — *"2 commits not pushed, uncommitted
changes"*.

An earlier draft reported only the unpushed commits, on the grounds that they
are the more urgent fact. That is true and not a reason to drop the other:
suppressing a true fact because a second one outranks it is precisely the
displacement `deferred` already causes to the note text, which
`agent-view-phase` is fixing. The two together also change the advice — *push
this* versus *push this, and someone is still working* — which is the whole
reason to distinguish them.

### What the row says

An unpushed count is not an age, and must not be shown as one — the same
separation `agent-view-phase` argued for the waiting age. *"2 commits not
pushed"* answers a question no timestamp can: it names an action, and the
action belongs to a specific machine.

## Branches

### Signal

- `bug/fleet-sees-unpushed-commits` — `local_ahead` in the scan's JSON;
  `classify()` lifts a branch out of quiet when commits exist locally that the
  remote lacks; the row says how many, distinctly from `local_dirty`

One branch: this is one field, one classifier rule and one row string, on top
of a mechanism already built and shipped.

## Done when

- **A branch with unpushed commits and a CLEAN worktree is not quiet.** The
  exact case that produced this plan — assert it with `local_dirty` false, or
  the shipped signal masks the new one and the test proves nothing.
- **A missing upstream is detected, not read as zero.** Assert the *failure was
  observed* rather than that the outcome happened to be right: `rc=128` with
  empty output is the signature, and a check on emptiness alone passes by
  accident.
- **A branch with no worktree on this machine answers exactly as today.**
  Without this, a regression that downgrades remote branches passes unnoticed.
- **Dirty and ahead stay distinguishable, and both are said.** Assert a branch
  that is both names the unpushed commits AND the uncommitted changes: a row
  that says only one of them hides either that finished work is unbacked or
  that someone is still working.
- **A local branch with NO worktree is still seen.** The assertion that fails
  if someone later routes this through the worktree list for consistency with
  `local_dirty` — which was this plan's own first draft. Refs are shared across
  worktrees, so the answer exists without one.
- **A branch that is BEHIND the remote is not reported as ahead.** Assert zero:
  `A..B` and `B..A` are easy to swap, and the swapped version reports every
  branch someone else has pushed to as local work.
- **It never downgrades a group.** Assert against a branch whose PR already
  answers: the one-directional rule is what lets this be added without
  weakening refs-as-truth.
- `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Deferred deliberately on 2026-08-16 rather than folded into
[`fleet-sees-local-work`](2026-08-16-fleet-sees-local-work.md), which was
mid-implementation when the case appeared, or into
[`board-tells-the-truth`](2026-08-16-board-tells-the-truth.md), which is pure
rendering and test plumbing. This one touches `plot-fleet-scan.sh` and
`packages/board/src/server/fleet.ts` — **the two files
[`agent-view-phase`](2026-08-16-agent-view-phase.md) holds** while its Data wave
is in flight. It must not be dispatched until that wave merges.

Three parallel branches stayed collision-free earlier that day only because
nobody widened a scope after the fan-out began. This plan waits for the same
reason.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "The plan binds local_ahead to the worktree list, as local_dirty is. But worktrees SHARE the ref database — git rev-parse answers from the main repo for a branch checked out elsewhere.", "a": "Pure ref comparison, no worktree needed. Dirtiness belongs to a working directory; aheadness belongs to the refs. The worktree-shaped version would silently skip local branches with no worktree, which still hold invisible commits", "category": "technical-architecture"},
    {"q": "Which branches does it iterate over?", "a": "The ones the plans name, as today. The scan is a FLEET view, not a branch listing — #136 chose carefully which unplanned branches earn a row. Cost stays proportional to the plan, not the checkout", "category": "domain-rules"},
    {"q": "What about a branch that is BEHIND or diverged after a rebase?", "a": "Count ahead only. The question is whether work exists that nobody else can see; being behind is not invisible — it is in the remote — and reporting it answers a question with no action attached", "category": "domain-data"},
    {"q": "Dirty AND ahead — what does the row say?", "a": "Both, unpushed first. Suppressing a true fact because another outranks it is the same displacement `deferred` causes to the note text. The pair changes the advice: 'push this' vs 'push this, and someone is still working'", "category": "ux-happyPath"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": false, "data": true},
    "ux": {"happyPath": true, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
