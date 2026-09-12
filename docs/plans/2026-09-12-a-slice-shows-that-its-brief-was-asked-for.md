# A slice shows that its brief was asked for

> Three states render as one word. A slice nobody asked about, a slice whose brief is being written, and a slice whose brief writer died all read *approved — nobody has taken it*.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A slice whose brief has been asked for says so, with when it was asked and whether the writer produced anything. A writer that died leaving an empty log is named as such rather than reading as a slice nobody has touched.

<!-- Board impact: this IS the board. The row gains a reading; rebuild the artifact. -->

## Motivation

**Measured 2026-09-12, on the operator's own board.** `a-marker-names-its-writer` read `approved — nobody has taken it` for over an hour. `plot-dispatch.sh` had reported `brief_asked=1`, named its log at `.plot/brief-a-marker-names-its-writer.log`, and the file was **0 bytes with no process behind it**. The writer was asked, started, and died producing nothing.

**The operator asked the right question**: *"shall we indicate that the slice is claimed and the brief is currently written? UI does not show any action."* The board could not answer it, because it renders one word for three different situations.

| what is true | what the board says |
|---|---|
| nobody has asked for a brief | `approved — nobody has taken it` |
| a brief is being written now | `approved — nobody has taken it` |
| a brief was asked for and the writer died | `approved — nobody has taken it` |

**The third is the one that costs time.** `plot-dispatch.sh:109` already warns about it — *"`brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN"* — and the per-branch line says *"read the log to see whether it wrote anything."* That instruction reaches whoever ran the command, once, in a terminal. It does not reach the board, and nobody read it.

**The evidence is already on disk.** `plot-dispatch.sh` writes `.plot/brief-<slug>.log` for every ask. Its existence dates the ask; its size says whether the writer produced anything; a process check says whether one is still running. All three are local reads.

## Design

### Approach

The row's reading gains a third answer, derived from the log file beside the repo:

| log | process | the row says |
|---|---|---|
| absent | — | nobody has asked — names `/plot-implement`, as today |
| present, non-empty, writer alive | alive | a brief is being written, asked `<when>` |
| present, writer gone, no brief on `origin/main` | gone | **the brief writer stopped without writing one** — names the log |

The first case is today's behaviour exactly, and stays word for word. A repository that never asks for briefs sees no change.

### It reports and offers nothing

`row-identity.ts:153` already settled the adjacent question and its reasoning holds: *"Whether the board should offer the brief-writing action is an Open Point the plan recorded and declined to settle — running `/plot-implement` is a real write, and the board's line is drawn at the acting endpoints it already has."*

**This plan does not reopen that.** It makes the row's existing sentence *true* rather than adding a button. The distinction that section draws — *"an operator told `nobody has taken it` runs `/plot-dispatch`; an operator told this runs the thing that helps"* — is exactly what a wrong word costs: the operator runs the useless command, because the row named it.

### The third state is a finding, not a failure

A dead brief writer is worth naming and is not worth refusing anything over. It blocks no gate and fails no check; it just means a slice is waiting on something that will never arrive.

So the row states it, names the log, and stops — the shape `plot-reconcile-scan.sh` uses for every advisory section.

### The reading is local and cheap

A file stat and a process check, per eligible-and-unclaimed slice. No host call, and nothing for a slice that is claimed or complete — those have an agent and the board already says so.

**It is also per-machine, and that is honest.** A brief asked for on another machine leaves no log here, so the row falls back to *nobody has asked*, which is what this machine can truthfully say. The alternative — inferring an ask from its absence — would invent a state nobody observed.

### Open Questions

- [ ] Should a dead writer's slice be re-asked automatically? [auto-dispatch-asks-for-the-brief](2026-09-12-auto-dispatch-asks-for-the-brief.md) will ask once; whether it retries after a death is that plan's question, and this one only makes the death visible.
- [ ] How long before a live writer counts as stalled? A brief took 60–75 seconds today; nothing measures the distribution. No bound is proposed here — *alive* is reported as alive however long it has run.

## Slices

### A slice shows that its brief was asked for (Branch: feature/a-slice-shows-that-its-brief-was-asked-for)

The three-way reading, the row's wording for each, and the fixture that covers a 0-byte log with no process — the case measured today.

## Notes

This is the read-only half of a pair. [auto-dispatch-asks-for-the-brief](2026-09-12-auto-dispatch-asks-for-the-brief.md) removes most instances of the waiting state by asking for the brief automatically; this one makes the remainder legible. Neither depends on the other, and the second is worth having even when the first lands: a writer that dies is exactly the case an automatic ask cannot fix.
