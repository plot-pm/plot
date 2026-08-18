# The board answers agents, not only eyes

> The board is excellent at *what is true* and silent on *what should I do, and did my action land*. Agents need the second more than the first.

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session

## Changelog

- `/api/fleet` reports which ref it read and how old that read is, so a consumer can distinguish a current board from a board that is current about an old world.
- New `GET /api/next`: one claimable branch with everything needed to start it — the answer `plot-fleet-scan.sh --next` already computes, over HTTP.
- New `POST /api/claim` and `POST /api/transition`: agents change state through validated calls that return the resulting state, instead of editing markdown and hoping the derived view agrees.

## Motivation

The read path is the most engineered part of this system and it has earned that.
Measured 2026-08-18 during a live two-agent dispatch: a 5 s scan cache
(`REFRESH_MS`), a 60 s PR refresh with rate-limit backoff (`PR_REFRESH_MS`,
`PR_BACKOFF_MAX_MS`), a disk-persisted last-good pulse that survives a
`--watch` restart, and staleness rendered honestly rather than hidden. During
that session an operator blamed the pulse loop three times. It was right three
times.

The **write path is two endpoints**, both human-clicked and same-origin locked:

| Endpoint | Direction |
|---|---|
| `/api/board`, `/api/fleet` | read |
| `/api/approve`, `/api/dispatch` | write |

That is the shape of a dashboard for an eye that glances. Agents do not glance,
and every failure in that session came from the write side, where there is no
design at all.

### What the session actually demonstrated

An agent hand-wrote a plan file. It parsed `canonical`, carried the right
phase, and sat on `origin/main` — and it was **invisible** to every unscoped
scan, because no symlink existed in `docs/plans/active/`. The plan was valid and
unreachable at the same time, and nothing said so at the moment of writing.

`plot-reconcile-scan.sh` catches this correctly, in section 5, with the exact
`ln -s` fix. But reconcile is something a human runs *afterwards*. The agent
that created the invisible plan got no signal at the time, and the board could
not distinguish *no such plan* from *plan not indexed*.

`/plot-idea` would have created the symlink. The gap is not the check — it is
that correctness depends on a convention an agent only follows if it happens to
use the right command.

### The shape of the problem

Plot's Principle 1 is *git is the database*, and that holds for plan **content**.
But `docs/plans/active/` is a hand-maintained **index into** that database — a
query path, not a fact. An index needs either enforcement or elimination. Plot
has neither, so it gets silent invisibility.

An agent's whole loop today is: read several scripts, guess which applies, edit
markdown, push, and hope the derived view agrees. Each step can fail quietly.

## Design

### Approach

Three additions, smallest and most independent first. Each is useful alone;
none requires the next.

**1. The response says what it read.** `/api/fleet` gains `readRef`,
`readRefAge`, and `localHead`. The UI already renders "scanned 10s ago"
beautifully — this is the same honesty for a machine consumer, and it closes the
gap where an operator reads current data about a stale ref. Pairs with the
banner fix in
`docs/plans/2026-08-18-the-pulse-names-the-ref-it-read.md`, which corrects the
same confusion in the CLI.

**2. `GET /api/next`.** `plot-fleet-scan.sh --next` already names one claimable
branch and exits 1 when there is nothing. Expose it with the context a starter
needs: the branch, its plan, its wave, its brief path, and whether a worktree
already exists. An agent's opening move becomes one call instead of a decision
tree over five scripts.

Read-only and idempotent — it *names* a candidate, it does not reserve one.
Reserving is `/api/claim`, deliberately separate: an agent that asks what is
available has not yet committed to doing it, and conflating the two would make
a survey a mutation.

**3. `POST /api/claim` and `POST /api/transition`.** The phase guardrails
(cannot approve an unreviewed draft, cannot deliver with open impl PRs, cannot
release undelivered work) exist today as prose in the spoke commands.
`CLAUDE.md`'s *Gates Over Rules* is explicit that prose MUSTs eventually get
violated. Endpoints that validate and return the resulting state make them
gates: the caller cannot claim to have transitioned without the transition
having happened.

Each returns the post-state, so the caller never has to re-derive whether its
write landed — the failure that produced an invisible plan.

**Claims stay ref pushes.** `plot-dispatch.sh` already claims atomically by
pushing a ref, and that is what makes the fleet restartable — kill anything and
the next pulse re-derives truth from git. The endpoint wraps that mechanism; it
must not replace it with server-side state, which would put a second source of
truth beside the repository.

### Deliberately not in this plan

**Removing `docs/plans/active/`.** The scan already parses every plan's phase
and could group without symlinks, which would delete this failure class rather
than report it. That is the better fix and a larger one — it touches the scan,
the board, `/plot-idea`, `/plot-deliver`, and every existing repo's layout. It
deserves its own interrogation rather than being folded in here.

**Authentication.** `/api/dispatch` is same-origin locked because it spawns
processes. The write endpoints need at least that, and an agent calling from a
worktree is not a browser — the trust model is a real design question, not a
detail. It gates branch 3 and is called out in the Open Points rather than
assumed.

### Open Points

- [ ] What authenticates an agent to the write endpoints? Same-origin does not
      describe a local process. A token in the worktree, a unix socket, and
      loopback-only are all plausible; the answer decides whether branch 3 is
      small or large.
- [ ] Should `/api/next` accept a capability hint (e.g. "shell only", "no
      network") so a fleet of unlike agents gets appropriate work? Real once
      more than one kind of worker exists; speculative before that.
- [ ] Does `/api/transition` supersede the spoke commands, or wrap them? Wrapping
      keeps one implementation and inherits their prose; superseding duplicates
      the guardrails in two places, which is how they drift.

## Branches

### Honesty

- `feature/fleet-api-names-its-ref` — `/api/fleet` reports `readRef`, `readRefAge`, `localHead`. Smallest of the three, and the one that would have prevented three misdiagnoses in one session.

### Ask

- `feature/api-next-names-one-branch` — `GET /api/next` over the existing `--next` computation, with plan, wave, brief path, and worktree state. Read-only; reserves nothing.

### Act

- `feature/api-claim-and-transition` — `POST /api/claim` and `POST /api/transition`, wrapping the existing ref-push claim and the spokes' phase guardrails, each returning the resulting state. Blocked on the authentication question above.

## Notes

The three waves are ordered by how much has to be decided before they can start.
Wave 1 is a reporting change with no open questions. Wave 2 exposes a
computation that already exists. Wave 3 cannot start until the trust model is
settled, which is why it is last rather than largest.

Session evidence for all of this: `docs/sessionlogs/` for 2026-08-18, and the
dispatch of `docs/plans/2026-08-18-plot-board-setup.md`, during which the
invisible-plan failure occurred and was diagnosed.
