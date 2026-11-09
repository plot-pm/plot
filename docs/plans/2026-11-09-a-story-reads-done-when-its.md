# A story reads Done when its existing plans are finished

> The Stories tab places a story by its plan files alone, so a story whose written plans are all Delivered reads Done while its table names more plans. The lane takes Done and Archived from the story's declared status, and the progress bar counts the plans the story's table names beside the plan files.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3306
- **Review:** pr
- **Impl:** own branches

## Changelog

- A story no longer moves to Done because its existing plans are Delivered; its declared status decides Done and Archived, and its plans move it forward to Active at most.
- The progress bar counts every plan slug in the story's plan table, plus any plan file that names the story. A slug with no file counts as not started.

<!-- Board impact: changes the story lane and progress the board renders; no change to the plan format, template or helper scripts. -->

## Motivation

Measured 2026-11-09 on the board, three stories read Done and the Active lane was empty:

| Story | File `status:` | Lane | Plans the table names | Plan files counted | Bar |
|---|---|---|---|---|---|
| #3170 Nothing changed, nothing runs | `ready` | Done | 18 | 5, all Delivered | 5/5 |
| The fleet delivers a scope alone | `active` | Done | none | 11, all Released | 11/11 |
| The shell holds no behavior | `active` | Done | none | 4, all Released | 4/4 |

#3170 has Phases 3 to 8 open and 13 of its 18 plans have no file. The card reads Done with the hint "status behind: plans delivered", which tells a person to move the story forward when the story is ahead of its plans.

## Design

### Approach

- **Lane:** `derivedStanding` (`packages/domain/src/transitions/story.ts`) returns `done` when every plan file is Delivered or Released and `archived` when every one is Released. `storyLane` (`packages/domain/src/rules/story-lane.ts`) maps both to Done. Plans may move a story forward to `active` at most. `done` and `archived` come only from the declared `status:` or from the story's location under `archived/`.
- **Hint:** `status-behind` (`packages/board/src/app/lib/card-presentation.ts`, `docs/domain/card-grammar.md`) stays for an Active story and for a story whose plans are all finished. Its wording states a hint, for example *plans delivered; story still open*, and not a proven state.
- **Progress:** the denominator is the union of the plan slugs in the story's plan table and the plan files whose `Story:` field names the story. A slug with no file counts as not started. #3170 then reads 4/18 delivered, or 5/19 with `the-board-starts-agent-runs-in`, which names the story and is not in its table.
- The domain owns both rules, and a unit test asserts each (CLAUDE.md, *Every rendered state is a domain property*).

### Open Questions

- [x] Does `STANDING_RANK` in `story.ts` still need the `done` and `archived` ranks once `derivedStanding` stops producing them? → Yes. `derivedStanding` keeps producing them (see the next answer), and `statusBehind` and `statusDrift` still rank them.
- [x] Does any other reader of `derivedStanding` (`board.ts`, `entry/standing.ts`) depend on the `done` answer? → Yes, three readers. `story-card-facts.ts:102` feeds the "status behind" hint through `statusBehind`; `entry/standing.ts:82` reports drift to the shell through `statusDrift`; `board.ts:2189` places the lane. The first two need `done` and `archived` as *what the plans prove*. So `derivedStanding` keeps its answers, and only the lane changes: a new domain rule `laneStanding(declared, derived)` answers `derived` capped at `active`, unless `declared` is `done` or `archived`, which it keeps. `board.ts:2189` calls `laneStanding` for the lane.

## Slices

### Lane and progress

- `bug/a-story-reads-done-when-its` — a new domain rule `laneStanding(declared, derived)` caps the lane at Active unless the story declares `done` or `archived`, and `board.ts` places the lane with it; `derivedStanding`, `statusBehind` and `statusDrift` keep their answers; the progress denominator takes the union of the story's plan-table slugs and the plan files that name the story; the status-behind hint for `done`/`archived` reads as a hint ("all plans so far delivered"), not as a proven state

## Notes

Source: tracker issue #3306. Done when:

- A unit test on the domain rule: a story declared `ready` or `active` whose every plan file is Delivered stays in Active.
- A unit test: a story whose table names 18 plans with 4 files Delivered reports 4 of 18.
- The board shows #3170 in Active with 4/18 (or 5/19).
