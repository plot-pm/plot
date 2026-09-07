---
'plot': minor
---

`plot-story-lint.sh` reports a story whose written `status:` is behind what its plans say, as S5. It names both the status and what the plans prove, and corrects neither: `entities/story.ts` settles that the six written statuses are a person's, because no mechanism can observe whether knowledge is still being added to. It fires on the measured case — a story reading `draft` while four of its four plans are Approved — plus three `done` stories whose plans have all released.

S5 is advisory and does not gate, where S1-S4 do. The four are broken pointers, each repairable by a mechanical edit anyone can make; a status behind its plans is a reporting gap whose repair is a word only a person can choose. The footer counts all five findings, so a reader sees everything; the exit code answers the narrower question a gate asks.

The comparison is not new. It existed as `computeStatusDrift` in the board and was already correct, so it moved rather than being rewritten — to `packages/domain/src/transitions/story.ts` as `statusDrift`, beside the `StoryStanding` it compares against, reached from the lint through the `plot-standing.mjs` bundle. The board now calls it there. The layering rule applied to a rule that was right and in the wrong layer: a shell lint cannot call a board function, so a person reading the board was the only thing catching this drift.

The status ordering it travelled with was a third list — four entries against the schema's six plus the derived seventh, silently omitting `ready`, `in-review` and `paused`. Whether a paused story could be behind its plans was answered by accident, through `indexOf` returning `-1`. All seven now rank explicitly, and `in-review` and `paused` rank nowhere on purpose: both say what the humans are doing rather than how far the work got, so neither is behind its plans.

<!--
plan: docs/plans/2026-09-06-a-story-says-what-it-is.md
bumps:
  skills:
    plot: minor
-->
