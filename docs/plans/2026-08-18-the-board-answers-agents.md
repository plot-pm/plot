# The board answers agents, not only eyes

> The board is excellent at *what is true* and silent on *what should I do, and did my action land*. Agents need the second more than the first.

## Status

- **Phase:** Released
- **Type:** feature
- **Story:** plot-board
- **Sprint:** working-shows-the-agent
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `feature/fleet-api-names-its-ref`
- **Started:** 2026-08-18, Jan Wloka, `feature/api-attention-says-what-needs-you`
- **Started:** 2026-08-19, Jan Wloka, `feature/api-claim-and-transition`
- **Delivered:** 2026-08-19, jwloka, PRs #212, #235, #251
- **Released:** 2026-08-22, v2.7.0

## Changelog

- `/api/fleet` reports which ref it read and how old that read is, so a consumer can distinguish a current board from a board that is current about an old world.
- New `GET /api/attention`: one call answering what needs a human, what needs an agent, what is waiting on an unanswered question, and what is claimable — the verdicts an operator otherwise assembles by hand from four separate reads.
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

**2. `GET /api/attention`.** One call that says what needs attention and from
whom — see the amendment below for why this replaced the narrower `/api/next`.
Four lists: `needsAgent` (abandoned work), `needsHuman` (a CI approval, a
conflict, a review), `waiting` (a worker holding the door open on an unanswered
question), and `claimable` (the original `--next` answer, unchanged).

Every input already exists on `/api/fleet` rows. What is new is the **verdict**
and the single action that clears it, so a caller stops assembling one by hand
from `state`, `note`, `localDirty`, `localAhead`, and a PID check.

Read-only and idempotent — it *names* candidates, it does not reserve or start
any of them. Reserving is `/api/claim` and starting is `/api/dispatch`, both
deliberately separate: an agent that asks what is available has not yet
committed to doing it, and conflating the two would make a survey a mutation.

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

### Amendment 2026-08-18: `/api/next` becomes `/api/attention`

Added after approval, while wave 1 was merging and wave 2 was still `open` and
unclaimed. Recorded rather than applied silently: a plan is frozen on approval,
so a scope change is a fact its worker and any later reader are entitled to see.

**What the session demonstrated.** An operator ran a shell guard
(`.dev/scripts/fleet-pulse.sh`) beside the board for an afternoon, and it
gathered **nothing the board did not already have**. Measured: `/api/fleet`
rows already carry `state`, `group`, `note`, `pr`, `localDirty`, `localAhead`,
`stuck`, `blockedBy`, `waitingOn`, and the worker's PID and liveness. The
board's own rows read `worker running (pid 20145)`.

The guard's entire value was three lines of **judgement** over that data: is
this worker abandoned, waiting on an unanswered question, or working? The board
had every input and stopped at reporting them — which is this plan's thesis
restated as a measurement: the read path answers *what is true* and is silent
on *what should I do*.

**So `/api/next` is too narrow.** It answers "what should I start?", and the
harder questions this session actually produced were "what needs rescuing?" and
"what is waiting on me?". One endpoint, four lists:

```
GET /api/attention
{
  "needsAgent": [{branch, verdict: "abandoned", action: "restart"}],
  "needsHuman": [{pr: 207, verdict: "ci-approval", action: "approve run"}],
  "waiting":    [{branch, verdict: "question", marker: "TODO(you)"}],
  "claimable":  [{branch, plan, wave, brief}]
}
```

`claimable` is the original `/api/next` scope, unchanged.

**Two verdicts the guard learned the hard way, and both must survive the port:**

1. **A worker that asked a question is not abandoned.** The guard restarted one
   branch twice while its worker waited on an answer it had asked for; the
   second restart re-ran work the first had finished. Uncommitted files look
   identical whether a worker walked away or is holding the door open. A
   `TODO(you)` marker **in the tree** distinguishes them — and the tree, not the
   log, is the right place to look: the log records that a question *was asked*,
   the marker records that it is still *unanswered*, and only the marker clears
   when someone writes the answer.

2. **An open PR is not abandonment.** Work that reached review has left the
   worker's hands, so leftover local edits there mean nothing. The
   classification order is load-bearing: alive → merged → open PR → dirty →
   ahead → claim-only.

**It reports; it does not act.** `/api/dispatch` already exists for spawning
work and is same-origin locked precisely because it spawns processes. Keeping
`/api/attention` read-only preserves the split this repo rests on — read-only
investigation gates every write — and leaves the seam where a human can
disagree with the verdict. That seam earned its place: the guard's judgement was
wrong twice before it learned about questions.

The shell guard stays in `.dev/scripts/` as the prototype it is, and is deleted
once this endpoint carries the same verdicts. Two things computing verdicts from
one dataset is how they drift.

### Open Points

- [x] What authenticates an agent to the write endpoints? **Answered
      2026-08-18: loopback binding is the boundary, and it already exists.**

      `isSameOrigin` guards *browsers*, not processes — both of its checks are
      conditional on the header being present:

      ```ts
      if (typeof site === 'string' && site !== 'same-origin') return false;
      if (typeof origin === 'string') { …allowlist… }
      return true;   // absent headers pass
      ```

      Verified live against the running board: a request with a hostile
      `Origin` gets **403**; a header-less `curl` gets **400** — it passed the
      origin guard and failed on the payload. So a local process *already* has
      write access to `/api/dispatch`, which spawns detached agents.

      A token on `/api/claim` would therefore be theatre while `/api/dispatch`
      sits open beside it. The work is not to invent a mechanism but to state
      the one in force and make it a gate: **refuse to start the write
      endpoints when `HOST` is not loopback**, unless an explicit flag opts in.
      Branch 3 is small, and it is no longer blocked.
- [ ] Should `/api/attention`'s `claimable` list accept a capability hint (e.g. "shell only", "no
      network") so a fleet of unlike agents gets appropriate work? Real once
      more than one kind of worker exists; speculative before that.
- [ ] Does `/api/transition` supersede the spoke commands, or wrap them? Wrapping
      keeps one implementation and inherits their prose; superseding duplicates
      the guardrails in two places, which is how they drift.

## Slices


### Honesty (Branch: feature/fleet-api-names-its-ref, PR: #212)
- `/api/fleet` reports `readRef`, `readRefAge`, `localHead`. Smallest of the three, and the one that would have prevented three misdiagnoses in one session.


### Ask (Branch: feature/api-attention-says-what-needs-you, PR: #235)
- **replaces the narrower `/api/next` by `GET /api/attention`, see the amendment below.** The original scope (name one claimable branch) survives as one of four lists that endpoint returns.


### Act (Branch: feature/api-claim-and-transition, PR: #251)
- `POST /api/claim` and `POST /api/transition`, wrapping the existing ref-push claim and the spokes' phase guardrails, each returning the resulting state. **No longer blocked** — the trust model was answered above: loopback is the boundary and already in force. This branch also carries the gate that makes it real: refuse to serve the write endpoints when `HOST` is not loopback, unless explicitly opted in.

## Notes

The three waves are ordered by how much has to be decided before they can start.
Wave 1 is a reporting change with no open questions. Wave 2 exposes a
computation that already exists. Wave 3 cannot start until the trust model is
settled, which is why it is last rather than largest.

Session evidence for all of this: `docs/sessionlogs/` for 2026-08-18, and the
dispatch of `docs/plans/2026-08-18-plot-board-setup.md`, during which the
invisible-plan failure occurred and was diagnosed.
