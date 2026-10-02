---
'plot': patch
'@plot-pm/board': patch
---

A slice the supervisor holds because an earlier slice of its plan carries a landing the host could not answer reads `prior-unknown`, where it read `not-claimable` before, and the tick line says how the merged listing answered: `merged-set=whole`, `merged-set=partial(<kind>)` or `merged-set=unaskable(<kind>)`, where `<kind>` is the host's refusal (`throttled`, `secondary` or `failed`).

Measured 2026-09-30 on a Bitbucket estate under HTTP 429: the supervisor held 36 slices `not-claimable`, among them slices whose earlier waves had merged days before, and nothing on the tick line named the 429. `not-claimable` means *the plan's ordering blocks this*, so a reader went to the plan and found nothing wrong with it. `not-claimable` is also the one hold a looping tick counts and never names, because it is proportional to the backlog — so the slice an operator was waiting for appeared only as a count.

`behindUnknownLanding` in `rules/queue.ts` decides it per plan, in plan order, over the plan's slice index rather than an entry's position: a slice naming two branches is two entries and one position, so a sibling is beside the unanswered branch rather than behind it. A later slice that is claimable in its own right is never marked — it keeps its own landing question. The hold itself does not change, and `queue-reading.test.ts`'s *"SILENCE MUST NOT PROMOTE WORK"* still holds.

No new host call: the `unknown` answers are the ones the pass already took. `prior-unknown` is `queue`-scoped in `HOLD_SCOPE`, so a looping tick names its branches under the existing cap.

<!--
plan: docs/plans/2026-10-01-a-hold-names-the-landing-nobody-could-answer.md
bumps:
  skills:
    plot: patch
-->
