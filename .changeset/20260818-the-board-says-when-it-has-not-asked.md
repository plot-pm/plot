---
"@plot-pm/board": patch
---

board: `none` is an observation, so it is only printed where one was made

`WAITING ON A MACHINE — none` was printed in two opposite situations: after
the host had answered and reported nothing pending, and before the host had
been asked at all. They want opposite responses from the reader, and the
reassuring one was the default.

Measured 2026-08-18 from two screenshots of one board 22 seconds apart. At
`PR data 22s ago` the section read `none` and no row carried a status. At
`PR data 4s ago` the same board reported #57 `conflicts`, #196 `checks
failing` since the previous day, and #203 `CI running`. Nothing changed on
the host between them. **A branch whose CI had been red overnight presented
as unremarkable**, and a branch the host reports as unmergeable presented the
same way. The operator's reading was that the board had lost its state; it
had not yet fetched it.

This is the rule `2026-08-17-an-outage-is-not-an-answer` established — a
failure to observe must not be reported as an observation — at the one
boundary that plan did not cross. An outage at least produces an error to
carry. A first fetch that has not happened produces nothing at all, which is
how it survived a plan written to catch exactly this shape.

The section now says which clock it was read from. Four states:

| Situation | Shown as |
|---|---|
| fetched, something pending | the rows, as today |
| fetched, nothing pending | `none` — unchanged |
| not fetched yet | `not checked yet` |
| first fetch failed | `could not reach the host` |

**A failed call is its own state, not a fourth spelling of the third.** Both
mean no host fact is on the board, so one label would have been defensible —
but `not checked yet` clears itself within seconds and asks the reader for
nothing, while an outage waits for somebody to read the error. Folding them
together would re-file a standing fault as a passing one, which is the
opposite of what `an-outage-is-not-an-answer` was for. The distinction costs
nothing to compute: `refreshPrs` already leaves `prAt` untouched when the
call throws, so a null age beside an error is a first fetch that FAILED
rather than one not yet made — and the footer has read the pair that way all
along.

**Header and body, not one or the other.** The header's hint is what a reader
sees while scanning, and QUIET and DONE prove a header can be the only part
of a section on screen; the empty-grid cell is what they see after opening
the section to look for rows. A single site would leave one of those two
readings unlabelled.

**A first-load state, not a staleness display.** Once the host has answered,
every later answer is an answer no matter how old: ordinary ageing is what
the footer already reports (`PR data 111s ago`), and re-labelling the section
every 60 s would trade one misreading for a flicker. The age is tested
against null and never against a threshold.

The two clocks stay separate, which was the point. `hostAnswer` takes
`Pick<Fleet, 'prAgeSeconds' | 'prError'>` rather than the whole fleet, so a
later edit reaching for the git scan's `ageSeconds` is a compile error rather
than a review comment — the window where rows are git-fresh and host-unfetched
is not an edge case, it is most of every minute.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` reads or documents what the Agents tab prints in an empty section,
and the `/api/fleet` payload is unchanged — every field this distinction is
drawn from (`prAgeSeconds`, `prError`) was already in the contract and already
in the footer. Only the rendering conflated them.
