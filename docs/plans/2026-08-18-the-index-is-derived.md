# The index is derived, not maintained

> `docs/plans/active/` is a hand-maintained query path into data git already holds. A plan can be valid, correct, and pushed — and invisible — because a symlink is missing.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-08-20, Jan Wloka, `feature/the-lifecycle-does-not-need-the-symlink`

## Changelog

- Plan phase grouping is derived from plan content rather than from symlinks in `docs/plans/active/` and `docs/plans/delivered/`, so a plan cannot be simultaneously valid and unreachable.

## Motivation

Manifesto Principle 1 is *git is the database*, and that holds for plan
**content**: phase, type, branches, and transitions all live in the file and are
re-read on every run. Nothing caches them, so nothing can disagree with them.

`docs/plans/active/` does not work that way. It is a directory of symlinks
maintained by hand — created by `/plot-idea`, moved by `/plot-deliver` — and it
is the **query path** every consumer uses to find plans:

```
plot-fleet-scan.sh:122   ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
```

So a plan's reachability is a fact about a symlink, while its correctness is a
fact about its content. The two can disagree, and when they do the plan is
invisible rather than wrong.

**Measured 2026-08-18.** An agent wrote a plan file directly rather than through
`/plot-idea`. It parsed `canonical`, carried `Phase: Approved`, named three
branches in two waves, and sat on `origin/main`. Every unscoped
`plot-fleet-scan.sh` reported 12 plans and did not include it. It appeared only
when its slug was named explicitly. Two agents were already working its branches
and the board's Agents tab showed neither.

The failure is silent in the direction that matters: the scan does not say "one
plan is unindexed", it says nothing at all, and its footer count is simply lower
than reality. There is no observation that distinguishes *this plan does not
exist* from *this plan is not indexed*.

### Why this is not just "run reconcile"

`plot-reconcile-scan.sh` detects it correctly, in section 5, with the exact
`ln -s` fix. That is the right behaviour for a sweep — but it is something a
human runs afterwards, and it cannot help the agent that created the invisible
plan at the moment it was created.

The check is also load-bearing precisely *because* the index can be wrong. If
the index were derived, the check would have nothing to detect: an entire
section of a maintenance tool exists to compensate for a data structure that
does not need to exist.

### What the index buys today

Honest accounting, because removing it is not free:

- **Humans browse it.** `ls docs/plans/active/` is a fast, obvious answer to
  "what is live?", and it works with no tooling at all.
- **Slug-named symlinks are stable.** Plan files are date-prefixed; the symlinks
  are not, so `docs/plans/active/plot-sprint-support.md` is a durable path.
- **It is cheap to read.** One `ls` versus parsing every plan file.

The third is the only one that argues against deriving, and it is measurable
rather than assumed: `plot-plan-meta.sh` already parses every plan in one
invocation for other purposes.

## Design

### Approach

**Derive the grouping; keep the directory as a convenience, not a dependency.**

Consumers stop asking "what is symlinked in `active/`?" and start asking "what
plans are there, and what phase does each declare?" — a question already
answered by the parser they all call. `active/` may continue to exist for human
browsing, and `/plot-idea` may keep creating symlinks; nothing *depends* on
them being right.

This is the same move Plot already made for merge detection, wave eligibility,
and claims: re-derive from git every run, keep no state that can drift.

Three questions decide whether this is a small change or a large one, and they
are the reason this is an idea plan rather than a specification:

1. **Cost.** How long does parsing every plan take against `ls` on a repo with
   hundreds of plans? Measure before designing around it. The board's 5 s cache
   and its existing `maxBuffer: 8 << 20` suggest headroom, but suggestion is not
   measurement.
2. **Compatibility.** Every adopting repo has an `active/` directory today.
   Deriving must not require them to change anything, and a repo whose symlinks
   are *wrong* should quietly become correct rather than throwing.
3. **The delivered/ split.** `delivered/` is a terminal index and behaves
   differently from `active/`. Deriving both from phase is the obvious move, but
   `Superseded` and `Rejected` already route to `delivered/` by special case
   (issue #33), and that logic has to land somewhere.

### Alternatives considered

**Enforce the index with a hook.** A PreToolUse gate that refuses a plan-file
commit without its symlink. Cheaper, and consistent with *Gates Over Rules* —
but it defends a structure whose existence is the problem, and every future
consumer still has to remember to read the index rather than the data.

**Report unindexed plans in the fleet scan.** The scan gains a line saying "1
plan not in the index". Honest and small, and strictly better than today. It
still leaves two sources of truth; it just makes their disagreement visible.

Both are reasonable if measurement kills the derive option. Neither is the fix.

### The measurement, and what it settles

Taken 2026-08-18 against generated fixtures on the session's machine, best of
three, timed from inside one process (a first attempt timed from the shell
produced impossible results — 500 plans "faster" than 100 — because `python3`
startup at ~40 ms swamped the signal):

| Plans | Parse all | Index-only (25% active) |
|---|---|---|
| 46 (this repo, real) | **94 ms** | — |
| 100 | 45 ms | — |
| 500 | 205 ms | — |
| 1000 | **432 ms** | **134 ms** |

Linear, ~0.44 ms per plan. The worst realistic penalty is **~300 ms at 1000
plans** — a scale no Plot repo has reached — behind a board cache that holds
for 5 seconds.

**This settles the plan's central question: derive.** The cost argument was the
only real objection, and it does not survive the numbers. Three hundred
milliseconds at a hypothetical scale buys the elimination of a failure class
that produced three incidents in a single session: a plan invisible to every
unscoped scan, a plan card that vanished from the board, and a `/plot-dispatch`
that could not find its own plan.

### Open Points
- [ ] Do the stable slug-named paths matter enough to keep generating symlinks
      after nothing reads them? A URL or a bookmark to `active/<slug>.md` is a
      real thing a human may hold.
- [ ] Does `/plot-deliver` still move symlinks, or does the phase edit become
      the whole transition? The second is simpler and changes what "delivering"
      means mechanically.
- [ ] If `active/` becomes advisory, what does `plot-reconcile-scan.sh` section
      5 report — nothing, or "your convenience index is out of date"?

## Branches

<!-- Populated 2026-08-18, after the measurement above. Three waves, ordered so
     each is independently valuable and none forces the next. -->

### Derive

- `feature/the-scan-derives-its-plan-list` — `plot-fleet-scan.sh` enumerates plans from the plan directory and groups them by their declared phase, rather than by which symlinks exist in `active/`. `active/` keeps working; nothing depends on it being right. Test: a plan with no symlink must appear, and a symlink pointing at a delivered plan must not resurrect it. → #254

### Report

- `feature/reconcile-calls-the-index-advisory` — once nothing reads `active/`, `plot-reconcile-scan.sh` section 5 stops reporting an unlinked plan as *orphaned* — it is not orphaned, it is fully visible — and reports index drift as the convenience-level finding it has become. Test: an unlinked plan produces no `attention` count; a symlink pointing nowhere still does.

### Stop depending

- `feature/the-lifecycle-does-not-need-the-symlink` — `/plot-idea` and `/plot-deliver` no longer depend on symlink maintenance for correctness. Whether they keep creating symlinks for human browsing is the first Open Point; this branch makes the lifecycle correct either way. Test: a plan created without a symlink is dispatchable, deliverable, and visible on the board.

## Notes

Originated during a live two-agent dispatch on 2026-08-18 (see
`docs/plans/2026-08-18-plot-board-setup.md`), where the invisible-plan failure
occurred, was misdiagnosed three times as a board defect, and turned out to be
a missing symlink.

Related: `docs/plans/2026-08-18-the-board-answers-agents.md` deliberately
excludes this change and says why — that plan makes the write path
agent-legible, this one asks whether the index should exist at all. They are
independent: either can land without the other.
