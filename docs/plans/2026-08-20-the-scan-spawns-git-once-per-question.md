# The scan spawns git once per question

> The board has shown `Last scan failed: timed out after 30000ms` through four
> rounds of optimisation, all of which targeted host round trips. Measured
> 2026-08-20 with a counting wrapper: the host is now **one** `pr-list`, and the
> scan spawns **459 git processes** at 56 ms of launch overhead each — roughly
> 24 s before git does any work at all. There is no hotspot. There are 8 spawns
> per branch across 54 branches.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — 459 git spawns measured at 56 ms each; pruning 33 worktrees took the scan 105 s to 63 s and proved the second multiplier
- **Started:** 2026-08-20, Jan Wloka, `bug/the-scan-walks-history-in-one-call`
- **Started:** 2026-08-20, Jan Wloka, `feature/the-scan-says-what-it-is-paying-for`

## Problem

### What was measured, and what it ruled out

A wrapper on `git` counting every invocation, on this repo, with no test load:

| | |
|---|---|
| git spawns per scan | **459** |
| wall clock | **105 s** |
| budget | 30 s |
| host calls | **1** `pr-list` (+ terminal cache hits) |

The cheap suspects, timed individually:

| Operation | Cost |
|---|---|
| `git fetch --prune` | 0 s |
| one `pr-list` | 1 s |
| 54 ancestry walks | 1 s |
| one `git status` in a worktree | 13 ms |
| `git worktree list` (cached once) | 11 ms |

**Two seconds of 105.** So the residue is neither the host nor any single git
operation — which is exactly why five rounds of hunting for a hotspot failed.

### The distribution says there is no hotspot

    68 rev-list   68 ls-tree   67 show   59 show-ref
    45 log        41 -C        28 rev-parse   19 hash-object

Nothing dominates. It is **8 spawns per branch × 54 branches**, and the cost is
the *spawning*, not the work.

### Two independent multipliers

**Spawn count** is one. **Spawn cost** is the other, and it is a property of the
repository's state rather than of the script: every `git` process reads the ref
database and worktree list at startup, so a fatter estate makes every spawn
slower.

Demonstrated by removing 33 finished worktrees — housekeeping only, no code:

| | worktrees | per-spawn | scan |
|---|---|---|---|
| before | 44 | 56 ms | 105 s |
| after | 11 | **31 ms** | **63 s** |

A 40 % cut from tidying up, and still **2× over budget**. That is the argument
for doing both: neither multiplier alone gets under 30 s.

## Design

### Batch the per-branch reads

Every one of the four biggest callers asks the same question 54 times, and each
has a batch form git already provides:

| Today | Batched |
|---|---|
| 59 × `show-ref` | one `git for-each-ref` |
| 67 × `show` | one `git cat-file --batch` |
| 68 × `rev-list` | `git rev-list --stdin` |
| 68 × `ls-tree` | one `cat-file --batch` over the tree oids |

Expected: **459 → ~40 spawns**, i.e. ~24 s of launch overhead → ~2 s.

The shape is the one `#232` already established for the host — replace N
per-branch questions with one batched question and a lookup — applied to git
instead. It is the same fix, in the place the cost actually is.

### What must not change

- **No answer may change.** This is a spawn-count change, not a semantics
  change. Every existing test must pass unedited; a test that needs editing
  means an answer moved.
- **The `-` versus `NONE` distinction survives.** A batched read that cannot
  answer for one branch must still report *could not observe* rather than
  *observed nothing* — the `an-outage-is-not-an-answer` rule, which two separate
  findings this month have turned on.
- **`local_ahead_of` keeps returning 0 for a missing upstream.** A test named
  *a MISSING upstream is detected, not read as zero* pins this, and an attempt
  to "improve" it on 2026-08-20 broke that test correctly.

### Why not raise the timeout

Rejected, and the measurement is the reason rather than taste. 30 s against a
scan that should take ~5 s is generous. A budget fitted to 105 s would hide the
next regression of the same kind, and the board's `--stream` design exists
precisely so a slow scan degrades visibly instead of lying.

### Why not parallelise the spawns

Considered. It would trade a wall-clock win for nondeterministic output ordering
and 54 concurrent processes against one object store — the contention that
starved three test files tonight. Batching removes the work; parallelism only
redistributes it.

### Open Points

- [ ] Should the scan **report** its estate size when spawn cost is high? A
      scan that says *44 worktrees, 56 ms per git* explains its own slowness,
      where a bare timeout does not.
- [ ] Is worktree pruning something Plot should offer (`/plot-reconcile`
      already reports stale branches) or strictly the operator's business?
      Removing a worktree can destroy uncommitted work, so it is a candidate
      for *report, never act*.

## Branches

### Batched
- `bug/the-scan-reads-refs-in-one-call` — replace the 59 per-branch `show-ref` and 28 `rev-parse` calls with one `git for-each-ref`, and the 67 `show` plus 68 `ls-tree` calls with `git cat-file --batch`. Tests: every existing reconcile test passes unedited; the spawn count for one scan is asserted below a bound with a counting wrapper; a ref that cannot be read still reports `-` and never `NONE`.
- `bug/the-scan-walks-history-in-one-call` — replace the 68 per-branch `rev-list` calls with batched forms (`--stdin` where the question is per-branch ancestry). Tests: ancestry verdicts are byte-identical on this repo's 54 branches; `local_ahead_of` still returns 0 for a missing upstream; the spawn bound holds.

### Said
- `feature/the-scan-says-what-it-is-paying-for` — when a scan exceeds its budget, it reports the estate that made it expensive (worktree count, spawn count, per-spawn cost) instead of only that it timed out. Tests: a scan under budget says nothing extra; one over budget names the counts; the numbers are measured, never estimated.

## Notes

The four earlier optimisations were not wasted — they removed the host cost,
which was real and is now one call. They simply kept aiming at the half of the
problem that had already been solved, because nobody had counted the other half.

The evening's other two corrections rhyme with this one. `the-no-ref-arm-asks-once-too`
assumed `refs=0` meant *merged* when it also means *never pushed*.
`a-held-branch-says-who-holds-it` assumed a clean worktree meant *idle* when it
also means *finished*. Here, four rounds assumed *slow* meant *the network*. Each
time one observable had two causes and the obvious one was picked without
measuring.

The 33 removed worktrees were mine, created one per agent across an evening and
never cleaned up. The tool got slower because of how I used it, and the scan had
no way to say so — which is what the third branch is for.
