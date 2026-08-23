---
"@plot-pm/board": patch
---

board: a folded wave head says what its verdict says, never that work landed

`groupedNote`'s fallback returned `work landed — waiting to be merged` for any
unrecognised word, and the `waveNote` call site short-circuited on
`groupedCount !== undefined` before the verdict could correct it. Since
`groupedCount` is defined for every multi-branch wave, the two verdict arms were
dead for every wave with more than one branch — so a `to approve` wave, whose
plan is still in review with no PR opened and nothing pushed, rendered a claim
that a merge was pending. Measured 2026-08-23, five live `blocked` waves each
asserted work had landed, two lines above their own rows reading *plan not
approved yet — still in review*.

Decided and enforced:

- **A note is DERIVED, never defaulted into.** `groupedNote` answers only for the
  two words a count can mean (`delivered`, `stalled`) and returns `''` for any
  other. Empty is falsy, so `waveNote` falls through to the verdict — the value
  that actually describes the wave.
- **No phase special-case.** Checking `phase === 'Discovery'` would silence
  today's instance and leave the fallback wrong for every other unrecognised
  word. The defect is a fallback that asserts, not drafts specifically.
- **A multi-branch wave can reach the verdict arms at all** — the `waveNote`
  ternary now `|| verdict` rather than short-circuiting on the count, so both
  `eligible` and `blocked` grouped waves render their verdict sentence.
