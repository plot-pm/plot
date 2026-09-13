# A slice shows that its brief was asked for

> Two states render as one word. A slice nobody asked about and a slice whose brief is being written both read *approved — nobody has taken it*.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-13, jwloka, in-session
- **Started:** 2026-09-13, jwloka, `feature/a-slice-shows-that-its-brief-was-asked-for`
- **Rounds:** 2

## Changelog

- A slice whose brief has been asked for says so, with how long ago. A slice nobody has asked about keeps today's wording.

<!-- Board impact: this IS the board. The row gains a reading; rebuild the artifact. -->

## Motivation

**Measured 2026-09-12, on the operator's own board.** `a-marker-names-its-writer` read `approved — nobody has taken it` while a brief was being written for it. The operator asked the question the board could not answer: *"shall we indicate that the slice is claimed and the brief is currently written? UI does not show any action."*

| what is true | what the board says |
|---|---|
| nobody has asked for a brief | `approved — nobody has taken it` |
| a brief is being written now | `approved — nobody has taken it` |

**The wrong word sends the operator to the wrong command.** `row-identity.ts:153` draws the distinction itself: *"an operator told `nobody has taken it` runs `/plot-dispatch`; an operator told this runs the thing that helps."* A slice already having its brief written needs neither — it needs waiting.

**AN ABSENT READING IS NOT A FAILED ONE, and this plan exists partly because its own author got that wrong.** Drafting it, I checked `.plot/brief-a-marker-names-its-writer.log` twice — at 25 and at 40 seconds — found 0 bytes with no process, and recorded a third state: *the writer died*. It had not. The log reached 2553 bytes and the brief landed on `origin/main`. A brief writer takes minutes and writes nothing until it is done.

**So the row states the AGE of the ask and never a verdict on it.** That is the reading which would have stopped the wrong conclusion: *asked 40s ago* invites waiting, where *the writer died* invites a person to intervene in work that is proceeding normally.

**The evidence is already on disk.** `plot-dispatch.sh` writes `.plot/brief-<slug>.log` for every ask. Its existence dates the ask. That is one stat call per eligible-and-unclaimed slice — no host call, and nothing for a slice that is claimed or complete.

## Design

### Approach

The row's reading gains a second answer, derived from the log file beside the repo:

| log | the row says |
|---|---|
| absent | nobody has asked — names `/plot-implement`, as today |
| present | a brief was asked for `<age>` ago |

The first case is today's behaviour exactly, word for word. A repository that never asks for briefs sees no change.

**No liveness check, and no bound.** The row reports when the ask was made and stops. Whether a writer is still running is a question this reading deliberately does not answer: a process check would tempt the reader — and did tempt this plan's author — to call an absent process a dead one, when a brief writer that has not yet written is the normal case. Nothing measures how long a brief takes; an invented threshold would report a healthy long brief as stalled.

### It reports and offers nothing

`row-identity.ts:153` already settled the adjacent question and its reasoning holds: *"Whether the board should offer the brief-writing action is an Open Point the plan recorded and declined to settle — running `/plot-implement` is a real write, and the board's line is drawn at the acting endpoints it already has."*

**This plan does not reopen that.** It makes the row's existing sentence *true* rather than adding a button. The distinction that section draws — *"an operator told `nobody has taken it` runs `/plot-dispatch`; an operator told this runs the thing that helps"* — is exactly what a wrong word costs: the operator runs the useless command, because the row named it.

### The reading is local and cheap

A file stat and a process check, per eligible-and-unclaimed slice. No host call, and nothing for a slice that is claimed or complete — those have an agent and the board already says so.

**It is also per-machine, and that is honest.** A brief asked for on another machine leaves no log here, so the row falls back to *nobody has asked*, which is what this machine can truthfully say. The alternative — inferring an ask from its absence — would invent a state nobody observed.

### Open Questions

- [x] How long before a brief writer counts as stalled? **No bound, and the row reports the age instead.** Nothing measures the distribution — 60–75 seconds was typical on 2026-09-12 and one took several minutes — so a threshold would be invented. The operator judges from the age.
- [ ] Should a brief that never lands be re-asked? [auto-dispatch-asks-for-the-brief](2026-09-12-auto-dispatch-asks-for-the-brief.md) asks once and records it. Whether it retries is that plan's question; this one only makes the first ask visible.

## Slices

### A slice shows that its brief was asked for (Branch: feature/a-slice-shows-that-its-brief-was-asked-for)

The two-way reading, the row's wording for each, and a fixture covering a log that exists but is empty — which means *asked recently*, not *failed*.

## Notes

This is the read-only half of a pair, and [auto-dispatch-asks-for-the-brief](2026-09-12-auto-dispatch-asks-for-the-brief.md) — the other half — merged on 2026-09-12. That one removes the operator from the asking; this one makes the waiting legible while it happens. The board now asks for briefs by itself, so the state this renders is the state it creates.
