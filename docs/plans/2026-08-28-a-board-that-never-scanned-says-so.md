# A board that never scanned says so

> A board whose first scan fails renders `Last scan failed: <error>` above a screen of `none` — and says nothing about having never had an answer at all. The warming state exists and is correct; it is simply unreachable once an error is set. Measured against the published 2.11.0 board: five pulses, `ready:false` throughout, and nothing on screen distinguishing *never scanned* from *nothing to show*.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-published-board-works
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Started:** 2026-08-28, Jan Wloka, `bug/a-board-that-never-scanned-says-so`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A board that has never completed a scan says so, even when the scan is failing — so a broken install reads as broken rather than as an empty estate.

<!-- Board impact: client only. AgentList's status assembly; no payload change,
     no server change, no contract change. -->

## Motivation

**The warming state already exists and is right.** `AgentList.tsx:504`:

```ts
if (!fleet.ready && !fleet.error) {
  return <p>Waiting for the first fleet scan…</p>;
}
```

Its comment argues the case exactly: *"a tab that has never had an answer cannot
have one it no longer trusts. The two are different statements, and merging them
would make an empty view claim data it never held."*

**The `&& !fleet.error` is the defect.** Once anything sets an error, the
warming branch is skipped and the reader gets the ordinary board — every section
rendering `none` — with an amber `Last scan failed: …` line above it.

**And that line hedges in a way that inverts here.** At `:574` it appends
*"— showing the last successful pulse below"* only when `ready` is true. So on a
board that has NEVER scanned, the message is bare — it names the failure and
says nothing about the emptiness beneath it, which is the fact the reader most
needs.

### Measured

**Against the published `@plot-pm/board@0.9.0`, fresh repo, 2026-08-28:**

```
t+10s  ready=false  rows=0  error=none                    ← "Waiting for the first fleet scan…"
t+20s  ready=false  rows=0  error=bash exited 127         ← "Last scan failed" + a board of `none`
t+50s  ready=false  rows=0  error=bash exited 127         ← unchanged, forever
```

**The board tells the truth for ten seconds and then stops.** From t+20s it is
indistinguishable, at a glance, from a healthy board over an empty estate.

**This cost two hours on 2026-08-28.** A stray board serving a one-plan fixture
showed exactly this shape, and the conclusion drawn — twice, by two readers —
was *the release is broken*. It was not; the board simply never said which of
its two silences it was in.

### Why it belongs in 2.11.1 rather than later

**It does not fix the published board; it makes the published board's failure
legible.** Ship the packaging fix alone and the next install-time failure —
whatever it is — reads exactly as this one did. **The Must makes the board work;
this makes its failures say so.**

## Design

### Approach

**Separate the two questions the render currently conflates:**

| | today | after |
|---|---|---|
| never scanned, no error | *"Waiting for the first fleet scan…"* | unchanged |
| **never scanned, scan failing** | **`Last scan failed` + a board of `none`** | **both facts, stated** |
| scanned before, now failing | `Last scan failed — showing the last successful pulse below` | unchanged |

**The middle row is the whole change.** A board with `!ready && error` must say
that it has never completed a scan *and* why the attempt failed — and it must
not render sections whose emptiness it cannot vouch for.

**The wording carries both, in the reader's order — what they are looking at,
then why:**

> **This board has never completed a scan, so it has nothing to show.**
> The last attempt failed: `bash exited 127`.

### What it must not do

**It must not hide the error.** The failure text is the only actionable thing on
screen, and a friendlier message that drops `bash exited 127` would have made
today's diagnosis impossible.

**It must not claim the estate is empty.** Rendering `none` per section is a
claim about the repository; a board that never scanned has no basis for it. The
sections are suppressed rather than filled with a fact nobody measured.

**It must not touch the stale path.** A board that scanned once and now fails is
a *different* statement and already reads correctly — its comment says so, and
merging the two is the error this plan exists to undo.

## Waves

### Told (Branch: bug/a-board-that-never-scanned-says-so, PR: #506)

The `!ready` case owns its render whether or not an error is set: the never-
scanned sentence, the error text beneath it, and no sections.

**Done when** a board with `ready:false` and an error renders both facts and no
`none` sections; a board with `ready:false` and no error is unchanged; a board
with `ready:true` and an error still says *showing the last successful pulse
below*; and a test covers all three.

## Notes

**Client-only.** No payload field, no server change, no contract change — the
two booleans the decision needs are already on the wire.

**The three cases are the test.** Each is a different sentence, and the bug is
that two of them currently produce the same screen.
