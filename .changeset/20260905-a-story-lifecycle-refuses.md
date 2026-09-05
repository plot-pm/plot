---
'@plot-pm/board': minor
---

The story's lifecycle is a domain rule that refuses illegal transitions.
`transitions/story.ts` carries the six statuses' legal edges, transcribed from
`DESIGN-story.md` §4, with 39 tests and 30 refusal assertions. `derivedStanding`
is the one place `archived` is computed, and it stays out of `StoryStatusSchema`
because the six are written by a person and `archived` is what the plans say.

The board reads that vocabulary instead of declaring it. `contract/schema.ts`
re-exports the domain's six rather than holding a hand copy, `deriveStoryStatus`
returns `StoryStanding` so its `return 'archived'` no longer type-checks against
`string`, and `StoriesTab` names its four columns as a subset of the union
rather than as a fifth list.

<!--
bumps:
  skills:
    plot: patch
-->
