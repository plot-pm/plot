---
"plot": minor
---

plot: plot-plan-meta.sh knows Design as a phase, and reports its record

`Design` was the one board column that named no phase. It was computed in
`toBoardPhase` as `approved && !started` — approved work with no commits on its
branch — and that inference reads a queue as a design stage. Measured on the
live board 2026-08-20: all three plans sitting in Design were fully specified,
interrogated and approved, every one carrying a brief and waiting for an agent.
Not one of them was being designed. A column defined by the *absence* of work
told its reader the opposite of what its name said.

So the parser learns the word. A plan in Design is one that cannot yet be handed
to development because it needs a spec, a spike or a tracer bullet first — a
statement about outstanding design work, which "nobody has picked this up"
cannot make. The two states want opposite reactions from whoever reads the
board, and only one of them was expressible.

**`design` is a phase, not a synonym.** `ready-for-review` and `in-review`
normalize onto `approved` because they *are* approved by another name; `design`
gets its own token beside `draft` and `approved`, because folding it into either
would re-create the conflation this removes.

**`design_raw` mirrors the three transition records exactly** — an `fm_design`
and a `canon_design`, front matter winning over the `## Status` body, resolved
through the same `strip_placeholder` precedence, emitted beside `approved_raw`.
It is reported for any plan carrying the line whatever its phase, the way
`approved_raw` outlives the Approved phase: a plan that *went through* design
keeps the record.

**Additive, and `test/reconcile/parser.test.mjs` proves it — 32 pre-existing
cases pass unedited, 156 lines added and none removed.** The six phase words
that parsed before parse identically now, asserted on the fixtures that already
existed rather than on new ones, and the two synonyms still fold onto
`approved`. All 66 plans in `docs/plans` parse byte-identically apart from an
empty `design_raw`. The error-path JSON gains the field too, so a caller
reading a missing file still gets the same shape as one reading a real plan.

**`design` is the one record whose name collides with a template section.**
Both plan templates carry a `## Design` heading, and every plan written from
them has prose under it. The record is read from `## Status` only, like its
three neighbours — a test pins that, because without it `design_raw` would fill
itself from the first sentence of the design discussion on most plans in the
repo.

Contract-level only. The gates (`plot-approve.sh`, `plot-phase-gate.sh`) and the
board column are separate waves — until the board wave lands, `toBoardPhase`
returns `null` for `design` and a plan written with the new phase is parsed but
not yet drawn, so nothing should be *set* to Design ahead of it.

<!--
bumps:
  skills:
    plot: minor
-->
