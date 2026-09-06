# A stated state is one the domain admits

> Three stories write `status: archived` and one sprint writes `Phase: Planned`. Neither value parses. Both were found by hand, in one session, because nothing checks a written state against the schema that defines it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- The parser refuses a stated state the domain does not admit, so every consumer gets the refusal instead of each checking for itself.

<!-- Board impact: the board renders parsed states; an unadmitted value stops
     rendering as if it were valid. No plan-format change. -->

## Motivation

**Four files hold a state their schema rejects.** Measured 2026-09-06:

```
docs/stories/plot-gates/…                        status: archived
docs/stories/setup-asks-what-the-repo…/…         status: archived
docs/stories/the-board-is-blank-where-it…/…      status: archived
docs/sprints/2026-W36-a-half-landed-workflow…    Phase: Planned
```

`StoryStatusSchema` admits `draft ready active in-review paused done`. `SprintStateSchema` admits `Planning Committed Active Closed`. **Neither `archived` nor `Planned` is in either.**

**BOTH WERE FOUND BY A PERSON READING FILES, IN ONE SESSION.** Nothing reported them. `plot-story-lint.sh` answers `0 finding(s)` over the three stories; the reconcile scan has thirteen sections and none asks whether a state parses.

**THE PLAN PARSER ALREADY DOES THIS, FOR PLANS ONLY.** `plot-plan-meta.sh:338` matches the seven plan states and returns `UNKNOWN` for anything else — a refusal every consumer inherits. Sprints and stories get no equivalent, and the script parses all three file kinds.

**`archived` IS THE MORE INTERESTING OF THE TWO.** `transitions/story.ts:26` says the six statuses are *"what a person writes"* and `archived` is *"what the plans say"* — derived, never stored. #707 made it unrepresentable in TypeScript and nobody swept the files. So three of them assert by hand a value the type system has since forbidden.

## What this is not

**Not a fifth lint.** The refusal belongs where the parse happens, so every consumer inherits it. A check bolted onto `plot-story-lint.sh` would leave sprints uncovered, and a sprint check would leave the next entity uncovered.

**Not a rewrite of the four files.** They are corrected — the stories through `archiveStory`, which writes status and date together, and the sprint by one word — but that is the repair, not the plan. The plan is that the fifth cannot arrive silently.

**Not a change to any schema.** `archived` stays derived and `Planning` stays spelled as it is. What changes is that a file cannot claim otherwise.

## Slices

### The parser refuses an unadmitted state (Branch: bug/a-stated-state-parses)

`plot-plan-meta.sh` answers `UNKNOWN` for a sprint phase or story status outside its schema, as it already does for a plan phase.

**THE SEVEN PLAN STATES ARE THE PATTERN AND IT IS ALREADY THERE.** `:338` matches an explicit list and falls through to `UNKNOWN`; `:339` maps two legacy spellings onto `approved`. Sprints and stories need the same two lines each and nothing more.

**`UNKNOWN` IS A READING, NOT AN ERROR.** The parser reports what it read and refuses nothing — `plot-plan-meta.sh` is the contract, and a consumer decides what an unparseable state means for it. That is the same direction `unaskable` takes for a host.

**THE LISTS COME FROM ONE PLACE.** `SprintStateSchema` and `StoryStatusSchema` are the domain's; a shell script cannot import them, so the values are duplicated by construction and the duplication must be **asserted** rather than hoped for. `test/reconcile/` already holds the plan-format contract tests, and this is one more.

**Done when** a story status or sprint phase outside its schema parses as `UNKNOWN`, the plan path is unchanged, and a test asserts each shell list against the domain's.

### The four files are corrected (Branch: bug/four-files-say-what-they-are)

The three stories go `done` with the archive date `archiveStory` writes; the sprint goes `Planning`.

**THE STORIES GO THROUGH THE TRANSITION, NOT AN EDITOR.** `transitions/story.ts:324` writes the status and the `archived:` date together and refuses `archive-date-missing`. Editing the status alone would trip S3 — *"done and an `archived:` date are two writes that must agree"* — swapping one invalid state for three lint findings.

**All three are archived in fact:** 6 of 6, 15 of 15 and 1 of 1 plans Released, so the derivation agrees with what the files assert.

**THE SPRINT IS ONE WORD.** `Planned` → `Planning`. It has not been touched since 2026-08-29 and none of its eight items ever became a plan, so nothing else about it changes here.

**Done when** all four files parse, `plot-story-lint.sh` exits 0, and the reconcile scan reports no unadmitted state.

## Notes

### Why this outranks the two plans that found it — 2026-09-06

`a-story-says-what-it-is` and `a-sprint-knows-when-it-ended` each found one instance and each proposed a check in its own lint. Reading them together showed one defect: **nothing validates a stated state anywhere.** Two lints would have left the third entity uncovered, and the fourth after it.

Those plans keep their other slices — the status-versus-plans drift, the index disagreement, the timebox — and hand this one over.
