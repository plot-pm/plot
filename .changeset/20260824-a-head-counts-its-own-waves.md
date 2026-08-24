---
"@plot-pm/board": patch
---

A plan head's *N waves elsewhere* count is measured against the waves the head
actually holds, rather than against the section it renders in.

A wave carries one of two sections (`done` or `not-started`, from whether it is
complete) while a row carries one of six, so a row needing attention sat in a
section no wave could match — and the head then counted every wave, including
its own, as elsewhere. Measured 2026-08-24: 30 of 80 rows disagreed with their
own wave's section, and 16 plan heads reported all their waves elsewhere,
one-wave plans among them announcing that their only wave was somewhere else.
