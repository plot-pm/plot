---
---

board: NOT STARTED says what each row is waiting for

Three rows in that section can look identical and mean opposite things:
one waits on a person, one is free to take, one cannot move until a
predecessor lands. The notes said so and were invisible until read.

The waiting-state now travels as a **field** (`waitingOn: you | click |
time`), computed server-side where the wave verdict and the plan phase
are both in hand — the row carries only its own wave name and could
never have derived it. The blocking wave travels with it (`blockedBy`),
so *blocked by an earlier wave* becomes **blocked by `Truth`**: *by which
one?* is the reader's unavoidable next question and it costs one string.

**Only `needs you` is loud.** `ready to start` keeps the ordinary note
colour — available, and taking it is optional — and `waiting its turn` is
quieter still. A section where every row is coloured has coloured
nothing, and blocked rows outnumber eligible ones two to one in a
multi-wave plan.

**A Draft plan colours only its FIRST wave.** The later ones would still
be blocked the instant the approval landed, so they read as *waiting its
turn*. This falls out of testing the wave verdict before the phase rather
than from a special case.

Nothing animates. Motion marks an unanswered request; a plan drafted
minutes ago is the ordinary state of a plan just written.

`isStartable` now reads the field instead of comparing the note against
`ELIGIBLE_NOTE` — the shape that fails silently, and would have failed
here, because this same change reworded a neighbouring note. The client
no longer imports any note constant.

<!--
bumps:
  skills:
    plot: patch
-->
