# plot-fleet — developer notes

Fleet pulse for wave-structured plans. `SKILL.md` is the agent-facing
instruction; this file is why it looks the way it does.

## What it is

A **read-only, stateless** report over one or more plans: which branch waves
are complete, eligible, or blocked, and which branches are claimed. It is half
of the parallel-agent story — the observing half. The acting half
(`/plot-dispatch`, worktree fan-out) is deliberately a separate command.

Design plan: `docs/plans/2026-08-14-parallel-agent-fleet.md` (Stage 1).

## Split: skill vs script

Per Manifesto Principle 3, *skills interpret and adapt; scripts collect and
report*:

| Layer | Responsibility |
|-------|----------------|
| `skills/plot/scripts/plot-fleet-scan.sh` | All arithmetic. Wave eligibility, claim detection, counts. Deterministic, small-model consumable. |
| `skills/plot-fleet/SKILL.md` | Interpretation. Which eligible branch to suggest, whether a stall is worth mentioning, what to tell the user next. |

The scan's last line is a machine-countable footer; consumers read it and never
re-count the body — the same contract `plot-reconcile-scan.sh` uses.

## Why there is no fleet database

Lloyd-style orchestrators keep tickets in SQLite because tickets have no
natural home. Plot's plans **are** the work table and `plot-plan-meta.sh` is
already the machine contract over them. A second store would violate Principle
1 and create precisely the drift `/plot-reconcile` exists to catch.

Consequence: the pulse is cheap and idempotent, and any component may die
without consequence. That is a feature — it is what makes the fleet
restartable.

## Wave eligibility, precisely

A wave is a `### ` subheading under `## Branches`. Ordering is document order.

- **complete** — every non-deferred branch in the wave is merged into main
- **eligible** — every *prior* wave is complete
- **blocked** — some prior wave still has outstanding work

A plan with **no** subheadings is one unnamed wave, so every pre-wave plan
behaves exactly as before. This is the backwards-compatibility guarantee, and
`test/reconcile/fleet.test.mjs` holds it.

`strict` (prior wave *merged*) is the default. The plan documents a `loose`
override (prior wave *green and ready*) that trades rebase risk for throughput
and requires a stated reason — not implemented in Stage 1.

## Claim detection

A branch whose remote ref exists but holds **no commits of its own** is a
claim: a worker pushed an empty branch to take the work. A ref push is atomic,
so the loser of a race is simply rejected — git is the lock, and no lock
manager exists or is wanted.

The plan's `<!-- claimed: … -->` annotation is a *reflection* for humans and
the board. Where annotation and git disagree, **git wins**. The one component
that reads the annotation is the reaper in `/plot-reconcile`, which needs it to
tell a deliberately abandoned claim from a dead worker — both leave an
identical empty branch.

## Filtering: what is not a branch

Not every prefixed token in a `## Branches` section is implementation work. The
scan skips:

- **`idea/` branches** — they carry the plan itself. Counting one as
  outstanding kept a finished wave blocked forever.
- **Tokens with a file extension** — `docs/` is a branch prefix, so a cited
  path like `` `docs/note.md` `` otherwise parses as a branch.

Both were found by running the pulse across the repo's real plans, not against
fixtures. Fixtures had named waves throughout; most real plans are pre-wave,
so the commonest shape was the untested one.

## Gotcha: tab is an IFS whitespace character

Bash `read` collapses runs of tabs into one separator, so a tab-separated row
with an **empty** field silently shifts every later field left. This bit twice
during development — once via the optional claim note, once via an unnamed
wave's empty name — and in both cases merged branches read as `open`, which
would keep a completed wave outstanding forever.

The fix is structural rather than positional: every emitted field carries a
`"-"` placeholder and can never be empty. Do not "simplify" that away.
Regression tests: `fleet: branches without a claim note keep their state` and
`fleet: an unnamed wave renders its branch as a branch`.

## Vocabulary: pulse, not heartbeat

`ralph-plot-sprint` (via `opus5-longhorizon-hardening`) uses **heartbeat** for
the liveness signal inside one serial run, with `Sprint heartbeat interval` and
`Sprint stall limit` config keys. This command's **pulse** is an observation
across a fleet — a different thing.

Reuse `Sprint stall limit` for staleness rather than adding a second timeout
key. One vocabulary for stalls was an explicit decision during plan
interrogation.

## Tests

- `test/reconcile/fleet.test.mjs` — builds a throwaway repo with a local bare
  origin, plants a merged branch, an empty claimed branch, a deferred branch,
  and a pre-wave plan, then asserts each verdict plus the footer counts.
- `packages/board/test/unit/schema.test.ts` — the `waves` contract at the
  board boundary, including the pre-wave default.

## `--next`: the pull side

`/plot-implement` calls `plot-fleet-scan.sh --next [<slug>]` to ask *what may I
take?* rather than walking the branch list in file order. It prints one branch
name (exit 0) or nothing (exit 1).

This is deliberately **pull, not push**. The plan's branch decomposition is a
guess made before the work started, and it is often wrong — branches split,
turn out unnecessary, or belong in a later wave. A dispatcher that *assigned*
branches up front would leave a session holding a stale ticket. Asking each
time means the plan file stays the single mutable truth and nothing caches an
assignment.

Exit 1 is a normal state ("everything eligible is claimed, or the next wave is
blocked"), not a failure — hence the exit code rather than an error message, so
callers can branch on it without parsing output.

## Strict vs loose eligibility

`--loose` lets a prior wave count as satisfied when its branches carry **pushed
work** rather than **merged work**. Strict is the default and should stay that
way: loose buys throughput and pays in rebase risk, because the next wave then
builds on a seam that has not landed. The plan requires a stated reason for
using it — the inverse of Principle 10's usual burden, since here it is *less*
safety that needs justifying.

## Known gaps

- Stall detection is described but not computed — the scan reports claims
  without ageing them. `Sprint stall limit` is the intended threshold.
- The pulse line records counts, not per-branch history; reconstructing "when
  was this branch claimed" still means reading git.
