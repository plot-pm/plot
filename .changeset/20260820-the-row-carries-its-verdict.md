---
"@plot-pm/board": minor
---

board: the row carries its wave verdict, and an eligible wave stops claiming to block

`AgentRowSchema` gains `verdict` — the shape the contract proposed at
`ELIGIBLE_NOTE` and declined to build, because the two branches that would have
collided with it were in flight. Both landed, so the stated reason for deferring
had expired.

Three verdicts left the scan and two sentences arrived. `ELIGIBLE_NOTE` carried
`eligible`, `blockedNote()` carried `blocked`, and `complete` had no carrier at
all: a merged branch of a still-open wave says *merged — wave still open*, which
is a fact about the branch and silent about the wave. So a consumer wanting the
verdict had two sentences to match and one case it could not reach — which is
why the two siblings waiting on this field, `a-branch-row-names-its-wave` and
`a-blocked-wave-names-its-blocker`, could not have read it out of prose.

`WaveVerdictSchema` is reused rather than a fourth state added. The row does not
classify itself here: it repeats what the scan decided about its wave, so a
fourth value would have to mean something the scan cannot say. The row's own
questions already have fields — `state` for its git shape, `group` for its
section, `waitingOn` for what would move it.

`classify()` returns it beside the note, from one reading of one argument. It
could have been taken from `wave.verdict` in `rowsFromPulse`, which has the wave
in hand — that would be a second derivation of one fact, and the field and the
sentence could then drift apart. The pair leaving one function together is what
makes them checkable against each other, and the tests check them as a pair.

The function was split to get there rather than threaded. `classify` has thirty
`return` sites and the verdict depends on none of the branching, so passing it
through each one would put thirty chances to forget it where there is one — and
a forgotten one fails by leaving the field null, indistinguishable from an older
scan. `classifyGroup` keeps the body verbatim; `classify` adds the field at the
single exit, with the signature and every argument position unchanged.

**Two collapses split, and neither was wrong on today's pulses.** That is the
finding, not an excuse: both agreed with the correct answer by an invariant of
`plot-fleet-scan.sh` — it clears `prior_ok` at the first incomplete wave, so
exactly one wave per plan can be `eligible` and it is the first non-complete one
— which the board neither states nor owns.

- The blocker search read `plan.waves.find((w) => w.verdict !== 'complete')`,
  so an `eligible` wave and a `blocked` one arrived as one answer. It now looks
  for the eligible wave, falling back to the first unfinished one where none is.
  A blocked wave named as a blocker answers *blocked by which one* with another
  blocked thing, which the comment above the search explicitly forbids and the
  old predicate permitted. The first-not-nearest property is kept in both arms
  and asserted separately, since a nearest-match implementation passes every
  other test in the block.
- `classify`'s `open` arm read `verdict !== 'eligible'`, sending `blocked`
  (true), `complete` (false — a finished wave blocks nobody) and an
  unrecognised verdict (unknowable) to one sentence. The blocked case is now
  named. `complete` and the unrecognised keep the same sentence deliberately:
  an `open` branch of a `complete` wave is a contradiction the scan cannot
  produce, so the arm may not invent prose for a row nobody has seen — and the
  row's `verdict` field now says which case actually arrived.

Additive and defaulted, the rule `issueAnswer` follows: a payload with no
`verdict` parses and parses to null. Null is also the answer where there is no
wave — a planless row built from the PR map, and a verdict this board does not
recognise. That row reaches `classify` with `'eligible'` as a routing value,
which steers the function into its PR arm; putting it on the row would claim the
ordering of a plan that does not exist had been satisfied.

`ELIGIBLE_NOTE`'s comment stops proposing this field, and two neighbouring
comments stop describing `isStartable` as matching `note === ELIGIBLE_NOTE` — it
has read `waitingOn` since that field landed. The prediction those comments made
came true in the same change that replaced them: *blocked by an earlier wave*
gained the wave's name, so a prose matcher would have gone quiet rather than
failed.

`verdict-not-prose.test.ts` makes that a gate instead of a paragraph. It scans
`src/` for a matcher against either sentence — an equality, a `.includes`, a
`.test`, a regex literal — and it checks the OPERATION rather than the words,
because two files legitimately contain them as data: `claim.ts` composes an
error message ending *blocked by an earlier wave*, and `AgentList.tsx` labels
the section *approved — nobody has taken it*. Both write prose for a person,
which is what prose is for; a check that fired on them would ask the board to
stop explaining itself in order to go green.

`plot-fleet-scan.sh` is untouched — it already computes every verdict this
displays, and Manifesto Principle 3 puts the interpretation on the board's side.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched, and the `/api/fleet` payload gains a field rather than changing one —
an older client's schema strips what it does not know, and an older server's
payload validates against the new one by the default.
