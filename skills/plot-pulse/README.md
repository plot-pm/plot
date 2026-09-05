# plot-pulse — developer notes

Fleet pulse for wave-structured plans. `SKILL.md` is the agent-facing
instruction; this file is why it looks the way it does.

## The name

This skill was `plot-fleet` until 2026-09-05. It kept every behaviour and took
the word it had always printed: the skill said *pulse* 26 times, its step 5 is
*Append a Pulse Line*, and the scan ends with `Pulse complete.`

`/plot-fleet` is now fleet control — `--start`, `--stop`, `--status`, `--once`
over `plot-registryd` and the agents. The split is machine against estate: that
command answers *what is running here*, this one answers *what does the estate
hold*. No alias was left behind; the name is reused, and one that answered a
pulse would give the old behaviour to somebody asking for the new one.

`plot-fleet-scan.sh` did **not** move. The scan reads the fleet and that name
is still right.

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
| `skills/plot-pulse/SKILL.md` | Interpretation. Which eligible branch to suggest, whether a stall is worth mentioning, what to tell the user next. |

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

A branch whose only commits beyond main are **empty `plot: claim …` markers**
is a claim: a dispatcher pushed it to take the work. Two independent claims
make two different commits, so they diverge and the loser's push is rejected
as non-fast-forward — git is the lock, and no lock manager exists or is wanted.

**The marker commit is load-bearing, and an earlier design got this wrong.**
Claiming by pushing an *empty branch* — one merely pointing at `origin/main` —
provides no exclusion at all: the remote already has that commit, so the second
push succeeds with "Everything up-to-date" and both dispatchers believe they
won. An audit reproduced exactly that, with two real dispatchers each reporting
`dispatched=1` for one branch. Git is the lock only when the refs diverge.

**Detection needs both halves.** A commit counts as a marker when its subject
is `plot: claim …` **and** it is empty (its tree equals its parent's). Matching
the subject alone let a human commit titled `plot: claim handling refactor`,
carrying real files, read as a claim — and with a `deferred:` annotation the
reaper then offered to *delete* a branch holding real, unmerged work.

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

### The offer asks the host, and `--offline` does not stop it

A caller of `--next` claims the branch it is given by pushing a ref. Merge state is the one fact refs cannot supply: a squash merge rewrites the commits, and `gh pr merge --delete-branch` takes the ref away, so nothing local names a branch that landed. The offer therefore asks the host even under `--offline` — that flag names the fetch, and everything else it used to silence followed from the two being one variable.

A branch the host could not be asked about reads `unknown` and is withheld. Silence is not permission: *"nobody has started this"* is precisely the claim that went unverified. The caller sees exit 1 and `--why-nothing` says which nothing it is.

Measured 2026-09-04 on the Plot estate: ten merged branches carried a ref whose tip commit is `plot: claim <branch>`, dated two to six hours **after** the branch's own merge. One branch was re-claimed twice, the second time 35 minutes after its ref was deleted by hand, with four waves blocked behind it each time. Every one of those refs was pushed on this offer.

The cost is one repo-wide `pr-list`, cached per run: 25 s against the ambient pulse's 0.76 s on that estate. It is paid only by a caller asking to be handed work, which is about to spend a worker on the answer. A repo with no git host configured asks nothing and still offers work.

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
