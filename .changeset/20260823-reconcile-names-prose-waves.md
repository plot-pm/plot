---
"plot": minor
---

`plot-plan-meta.sh` gains a top-level `long_wave_names` array: every wave name
longer than a threshold judgement (`LONG_WAVE_NAME_MAX`, set clear of the
estate's longest legitimate name `Offered first` at 13 and the 53-character
offender), in document order, empty when every name is a label. It is a REPORT,
never a refusal — `waves[]` is unchanged, no name is shortened or dropped, and
the plan still parses in full. Added as a NEW field, never a change to an
existing one, so every consumer of the existing shape is untouched.

`plot-reconcile-scan.sh` gains a section reporting those names: every over-long
wave heading, named with its plan file and the name, plus a machine-countable
`prose_wave_names=` footer entry the way each existing section has one. A wave
name is a label (Shaped, Gated, Offered first); a sentence-length heading is a
plan-authoring mistake the board can only render badly, so each finding prints
`rename: shorten the wave heading in prose <slug>`.

Like the unsliced-wave section it copies, it is deliberately non-blocking: it is
placed as section 8 (index drift renumbered to 9) and kept out of the
`attention=` count that gates `/plot-deliver` and the `/plot` hygiene line,
because a prose name is a shape to fix, not a branch that cannot move. The name
is read from `plot-plan-meta.sh`'s `long_wave_names` — never a second scan of
the file — so a backticked name in a plan's prose is not a wave name, and a
phase-less file is skipped (it is not a plan).

The `/plot-deliver` delivery-landed gate is unaffected: its stop marker
(`sed -n '/^== 7./q;p'`) already excludes every non-blocking section at 7 and
beyond, so it needs no change; only its prose is updated to name the new section
and renumber index drift to 9. `/plot-reconcile` (the scan's interpreter) and
`/plot`'s hygiene line have their prose, example footers and Automation Output
updated to name the new section and its `prose_wave_names=` count.

<!--
bumps:
  skills:
    plot: minor
    plot-deliver: patch
    plot-reconcile: patch
-->
