# `eligible` does not mean startable

> A row reads *eligible — nobody has taken it*, which invites the reader to
> take it. Nine such rows are on the board and not one of them can be started:
> every one is missing the brief a worker is told to read first. The server
> already knows this and the row does not say it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

Reported from the board on 2026-08-19: *"Warum steht 'eligible — nobody has
taken it' wenn es echte Abhängigkeiten gibt? Können wir diese nicht benennen?"*

The note is not wrong. It is **incomplete in a direction that costs work**: it
names a state and implies an action, and the action does not work.

### What `eligible` actually claims

`plot-fleet-scan.sh` calls a wave eligible when every non-deferred branch in
every prior wave is merged. That arithmetic is right, and the two branches that
prompted the question are genuinely eligible by it:

| Branch | Waited on | State |
|---|---|---|
| `feature/the-worker-command-says-nobody-is-watching` | `skills-know-when-nobody-is-there` | merged |
| `feature/api-claim-and-transition` | `api-attention-says-what-needs-you` | merged |

So the dependency the operator sensed was real, and is **satisfied**. The row
is telling the truth about waves.

### The fact it omits, which the server already has

A worker cannot start without a **brief**. The `Worker command` in `CLAUDE.md`
opens with *"Read `.plot/briefs/${PLOT_BRANCH##*/}.md` first — it is the
specification"*, and `plot-dispatch.sh` reports `brief=missing` unconditionally
because it cannot write one and never will: a brief is interpretation, and
`/plot-implement` owns it.

**Measured 2026-08-19: nine eligible branches on the board, zero briefs.**

This is not a missing measurement. `AgentRowSchema` already carries `briefPath`
and `briefExists` (`schema.ts:1865`), and `/api/attention` answers the question
for agents (`attention.ts:46`). **An agent asking the API is told; a person
reading the row is not.** The field reaches the row and is never rendered.

### Why the wording makes it worse rather than merely quieter

*"nobody has taken it"* reads as an invitation with a missing actor — the row
supplies the reason nobody has taken it as if it were an accident. The honest
reading is that the next action is not *take this branch* but *write its
brief*, and those are different jobs done by different things: a worker takes a
branch, `/plot-implement` writes a brief.

An operator following the row's suggestion runs `/plot-dispatch`, which starts
a worker that reads a file that is not there.

## Design

### Say which of the two it is

A row in NOT STARTED is in one of two states, and they have different next
actions:

| Condition | Row says | Next action |
|---|---|---|
| eligible, brief exists | *ready — nobody has taken it* | dispatch it |
| eligible, no brief | *needs a brief before it can start* | `/plot-implement` |

The second is the common case today — nine of nine — so it is not an edge to
tuck away.

**No new measurement.** Both fields are on the row already; this wave renders
what the server sends. That is the whole change on the read side, and it is why
this is a bug rather than a feature.

### Naming the dependency is a second question, and deliberately separate

The operator asked two things and only one is settled here. *Which wave did
this branch wait for* is a real question the row could answer, and
`a-wave-says-what-it-waits-for` (approved 2026-08-19) already owns it — that
plan gives a wave its own row and names what it waits on.

This plan does **not** touch that. A satisfied dependency is history; a missing
brief is a live obstacle, and conflating them would delay the cheap fix behind
the interesting one.

### Open Points

- [ ] Should the row OFFER the brief-writing action, or only name the gap?
      Offering it means the board runs `/plot-implement`, which writes a file
      and is a real write — the sprint that just ended drew its line at exactly
      one acting endpoint. Naming the gap is read-only and honest; offering the
      action is the thing an operator will ask for the day after.
- [ ] Does `plot-fleet-scan.sh`'s own text want the same split? The scan prints
      `eligible` in prose too, and a human reading the terminal has the same
      gap. The board is where it was reported, so the board is where this
      starts.

## Branches

- `bug/eligible-says-whether-it-can-start` — a NOT STARTED row distinguishes *ready* from *needs a brief*, rendering `briefExists` which the row already carries. Tests: a branch with a brief reads as ready; one without names the gap and does not invite a dispatch; the phrasing never claims a person is missing when a file is; a row whose `briefExists` is absent renders as it does today rather than guessing either way.

## Notes

Found by an operator reading the board, not by a test — the same route as most
of this repo's display defects. The distance between *the server knows* and
*the row says* is where they live.
