---
'@plot-pm/board': minor
---

board: an approved plan whose every wave has merged reaches the phase after Development on its own

A plan whose every non-deferred branch has merged sat in Development until a
person remembered to run `/plot-deliver`, and nobody did — measured
`merged_not_delivered=16` on 2026-08-21, drained by hand to 2 the next morning at
the cost of a person's morning, and back to 5 the day after as a fleet landed
more work. Detection already worked (`plot-reconcile-scan.sh` section 2 finds
every one); nothing acted on it, so the column quietly stopped being true.

The board now reads that same measurement. `allWavesMerged(meta, pulse)` is true
when every non-deferred branch of a plan is `merged` in the pulse — the same
derivation `plot-fleet-scan.sh` applies, read rather than rebuilt — and an
approved plan for which it holds is placed in the column after Development.

Decided and enforced:

- **It is a MEASUREMENT, never a delivery.** Reaching the column asserts the code
  landed, which git knows; it flips no phase, writes no `Delivered:` record and
  merges no PR. Delivering stays a decision a person makes from there
  (`docs/board-domain-model.md`). Asserted directly: the plan file still reads
  `Phase: Approved` after the card has moved.
- **The negative is asserted, not assumed.** A plan with one open branch stays in
  Development — an implementation that flagged everything would pass the positive
  test alone.
- **A deferred branch is exempt**, matching the scan: six merged and three
  deferred is as complete as nine merged. A plan with only deferred branches is
  NOT promoted — there is no landed work to testify to.
- **The source is the pulse, never the plan file.** No pulse, or a pulse that
  does not know the plan, keeps the card where it was — a cold cache is not "all
  merged".
- **The target column is read from `toBoardPhase('delivered')`, not restated**,
  so the later rename of that phase needs no edit to this derivation.
- **The derivation is the server's**, computed in `buildBoard`; the renderer
  reads `card.phase` and remakes nothing.
