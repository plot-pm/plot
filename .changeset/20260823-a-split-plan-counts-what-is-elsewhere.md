---
'@plot-pm/board': minor
---

board: a plan head says how many of its waves are in another section

A plan may span sections — a wave merged into DONE while a later wave waits in NOT
STARTED — and the board draws it one head per section. Each head's wave summary
counted only the waves in its own section and was silent about the rest, so the
visible half of a two-wave plan read indistinguishably from a plan that only ever
had one wave.

Each head now states how many of the plan's waves are elsewhere — *2 waves, first
eligible · 1 wave elsewhere* — read from the server-derived `fleet.waves`, where
each wave already carries its one section. A plan wholly within one section says
nothing extra. The count was undefined until a wave had a single section
(`a-wave-is-one-row`); it is well-defined now, so the omission is legible rather
than hidden.
