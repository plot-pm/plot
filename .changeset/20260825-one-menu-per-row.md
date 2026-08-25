---
"@plot-pm/board": patch
---

board: one `⋯` per row, with the wave's acts in a section

A plan row whose plan has exactly one eligible wave wore **two** three-dot
menus: `PlanActions` and, beside it, a sibling `WaveActions` carrying the
wave's *Start work*. The two buttons are identical to look at and hold
different acts, so the only way to learn which was which was to open both.

Reported from a running board on 2026-08-25.

The wave's act now renders **inside** `PlanActions`, under a labelled
`Wave <name>` rule. The acts are separated rather than flattened into one
list, because they answer different subjects: everything above the rule acts
on the PLAN, and the section below it acts on a WAVE. A reader can see which
is which without opening anything.

**The render gate had to widen with it.** `PlanActions` only draws its trigger
when `isDraftPlan || canDeliver || hasEligible`, and `hasEligible` reads
`card.waveSummary.eligible` — which a payload can report as 0 while the fleet
still names one eligible wave. The old sibling menu had no such gate; it
rendered on the wave's verdict alone. Folding the act inward without adding
`soleWave` to the gate deleted the control on exactly the rows this fixes,
and the browser test caught it.

Its anti-contract test is rewritten rather than deleted: it asserted the
second menu, which is the behaviour being reversed. It now pins **one**
trigger and a named wave section, and its sibling's `[data-wave-actions]`
assertion — which became vacuous once that attribute lived only on real wave
rows — was sharpened to assert on the section instead.
