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

The scan already enumerates worktrees and knows where each branch is checked
out; `fleet-sees-local-work` built that and kept the path in `local_worktree`.
This asks one more question of a worktree already found:

```sh
out=$(git -C "$path" rev-list --count "origin/$br..$br" 2>/dev/null); rc=$?
```

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

**No cap.** Measured: **5.75 ms** per call (20 iterations), against the 6.6 ms
per worktree the shipped scan already accepts. Twenty worktrees cost ≈115 ms on
a scan that runs 500–1050 ms. A cap would be stock against a problem the
numbers rule out.

**Dirty and ahead are different facts, and the row says which.** A worktree can
be both, either, or neither. `local_dirty` means *someone is editing*;
`local_ahead` means *finished work exists that nobody else can see*. The second
is the more urgent message — it is recoverable only from that machine — so
where both are true, the row reports the unpushed commits. Collapsing them into
one "local work" flag would lose the distinction that decides what the reader
should do: *wait* versus *go push it*.

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
- **Dirty and ahead stay distinguishable.** Assert a worktree that is both
  reports the unpushed commits; a row that says only "uncommitted changes"
  hides the fact that finished work is unbacked.
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
