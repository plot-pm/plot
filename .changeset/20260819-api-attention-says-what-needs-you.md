---
"@plot-pm/board": minor
---

board: `/api/attention` says what needs you, and what needs an agent

The read path is the most engineered part of this system and it answers exactly
one question: **what is true**. `/api/fleet` rows already carry `state`,
`group`, `note`, `pr`, `localDirty`, `localAhead`, `stuck`, `blockedBy`,
`waitingOn`, plus the worker's pid and liveness. What no endpoint answered was
**what should I do**.

Measured 2026-08-18: an operator ran a shell guard beside the board for an
afternoon and it gathered *nothing the board did not already have*. The board's
own rows read `worker running (pid 20145)`. The guard's entire value was three
lines of judgement over that data — is this worker abandoned, waiting on an
unanswered question, or working — and an agent had to reassemble those three
lines from four separate reads.

`GET /api/attention` returns one payload with four lists, split by **who can
clear it**:

```
needsAgent  work that stopped and needs a machine put back on it
needsHuman  a click, a look, a review, a rebase
waiting     a worker holding the door open on an unanswered question
claimable   branches nobody has taken, and where each brief is
```

**Every verdict traces to a fact the scan already reports**, and each entry
carries an `evidence` string naming the field it was read from
(`worker: failed`, `pr.state: none`, `stuck.state: unpushed`) so a caller can
audit the list against `/api/fleet` without running anything. This endpoint
adds no facts — it renames existing ones. A verdict the board guessed is the
defect this repo has spent days removing.

**Two verdicts the prototype learned the hard way, both ported:**

*A worker that asked a question is not abandoned.* The guard restarted one
branch twice while its worker waited on an answer it had asked for; the second
restart re-ran work the first had finished. `waiting` therefore gets its own
list rather than a place in `needsAgent` — it is the one state where the wrong
move actively destroys work, and a list a caller can see and skip is not the
same as one folded into a general pile.

*An open PR is not abandonment.* Work that reached review has left the worker's
hands, so leftover local edits there mean nothing. The classification order is
load-bearing and is the prototype's: alive → merged → open PR → worker verdict
→ unpushed.

**A cold cache does not read as an empty fleet.** Four empty lists mean
*nothing to do*, which invites a caller to stop; four empty lists before any
scan has landed mean *nothing has been read yet*, which invites it to wait and
ask again. `ready` separates them, and `readRef` says which world the verdicts
are about — a verdict is a stronger claim than a fact and needs the provenance
at least as much.

**`AgentRow` gains `worker`**, the scan's eight-state verdict forwarded
verbatim. It was already read by `rowsFromPulse` and dropped, surviving onto
the row only as prose inside `note` — the exact shape `localDirty` and
`localLocked` were in before the same forwarding fixed them. `waiting` and
`stalled` name opposite moves (*answer it* versus *resume it*), so a consumer
reduced to matching sentences to tell them apart is one rewording away from
restarting a worker into the question it asked. Forwarded, never re-derived:
liveness is decided once, in `plot-worker-state.sh`, and a structural test
asserts it.

**Read-only and idempotent.** It names candidates; it reserves nothing and
starts nothing. Claiming is `/api/claim` and starting is `/api/dispatch`, both
deliberately separate — an agent asking what is available has not yet committed
to doing it, and conflating the two would make a survey a mutation. A POST gets
the server's blanket 405.

**Open point answered: `claimable` takes no capability hint.** Deferred, on the
plan's own criterion — *real once more than one kind of worker exists,
speculative before that*. Every worker in this fleet is the same agent started
by the same `Worker command`, so a hint would have exactly one value on every
branch and no consumer able to disagree with it. Adding the field now would
mean designing a vocabulary (`shell only`, `no network`) against zero measured
demand and freezing it into a payload before anything could show it wrong;
adding it later is additive, and this endpoint's whole rule is that a field
must trace to a fact something already reports.

No skill version bumps: this is a board-side change only. Nothing under
`skills/` changed but the generated `board-server.mjs` artifact, which is
rebuilt output rather than authored skill content.
