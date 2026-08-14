---
"plot": minor
---

Close the three gaps between what the fleet plan promised and what it shipped.

Delivery verification compared the plan's changelog against the actual diffs and found three entries the implementation had not backed. Rather than soften the changelog, the work was finished:

**Wave eligibility is now genuinely configurable.** `--loose` lets a prior wave count as satisfied when its branches carry pushed work rather than merged work. Strict stays the default, because loose buys throughput and pays in rebase risk — the next wave builds on a seam that has not landed. Using it wants a stated reason; this is the one place where *less* safety is what needs justifying.

**The pulse can write a pulse line.** `--log-pulse` appends one line per plan to its `## Notes`, clean pulses included — without a record of quiet pulses an idle fleet and a dead fleet look identical. It stays a log rather than state: deleting the whole log changes no behaviour, because the next pulse re-derives everything from git. Without the flag the scan remains strictly read-only.

**The board shows wave state.** Cards carry a `waveSummary` — waves, outstanding branches, claimed branches — rendered as a badge. It is a summary rather than the nested wave structure because a tile answers "how much is left, and is anyone on it?", not "which branch sits in which wave". Deferred branches are excluded from the outstanding count; counting them would make a finished plan look unfinished. Plans with one wave or none carry no badge, so pre-wave plans are untouched.

<!--
bumps:
  skills:
    plot-fleet: minor
-->
