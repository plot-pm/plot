## Implementation brief — a-story-reads-done-when-its (wave 1: Lane and progress)

- **Plan (canonical):** `docs/plans/2026-11-09-a-story-reads-done-when-its.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3307 merged
- **Branch:** `bug/a-story-reads-done-when-its` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

Three stories read Done on the board while the Active lane is empty (measured 2026-11-09, issue #3306). #3170 *Nothing changed, nothing runs* declares `status: ready`, names 18 plans in its table, has 5 plan files and all 5 are Delivered, so `derivedStanding` returns `done`, `storyLane` maps that to Done, and the bar reads 5/5. 13 of its 18 plans have no file. The card also says "status behind: plans delivered", which tells a person to move a story forward that is ahead of its plans.

Build three changes on top of what exists:

- **Lane.** Add `laneStanding(declared, derived)` as a new domain rule. It returns `derived` capped at `active`, unless `declared` is `done` or `archived`, which it keeps. `deriveStoryStatus` feeds the lane through it. The cap is the whole fix for the lane: a story whose plans are all finished moves to Active at most.
- **Progress.** `progress.work` in `storyCardFacts` counts the plans that have a file. The denominator becomes the union of the plan slugs in the story's plan table and the plan files whose `Story:` field names the story. A slug with no file counts as not started. #3170 then reads 4/18, or 5/19 with `the-board-starts-agent-runs-in`, which names the story and is not in its table.
- **Hint.** `status-behind` for `done` and `archived` keeps firing, and its wording reads as a hint, for example *plans delivered; story still open*, not as a proven state.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**`derivedStanding` keeps its answers; only the lane changes.** The obvious fix is to stop `derivedStanding` returning `done` and `archived`. Three readers need them as *what the plans prove*: `story-card-facts.ts:102` feeds the hint through `statusBehind`, `entry/standing.ts:82` reports drift to the shell through `statusDrift`, and `board.ts:2189` places the lane. Change `derivedStanding` and the first two lose their input. So `STANDING_RANK` keeps its `done` and `archived` ranks too.

**The lane has two call sites, and the first one is easy to miss.** `deriveStoryStatus` (`board.ts:2174`) sets `status` on each `StoryCard` at `board.ts:2338`, and `discovery-lanes.ts:147-160` calls `deriveStoryStatus(s.status, s.plans)` a second time to build the `standing` that `storyLanes` groups by. `s.status` there is already the derived value, not the declared one, because `board.ts:2338` overwrote it. `laneStanding` needs the declared status, which the card keeps as `declaredStatus` (`schema.ts:977`). Read `declaredStatus` at the lane site. Feeding the derived value back in as `declared` makes a `done` derived standing look like a declared `done`, and the cap never applies. The unit test for this must use a story whose declared status is `ready` and whose plans are all Delivered, and assert Active, because a test that passes `done` as declared passes either way.

**A story under `archived/` still renders Archived.** `storyLane` already lets the location win (`story-lane.ts:36`). `laneStanding` does not touch that.

**The plan table has no parser and no fixed shape.** `parseStoryContent` (`board.ts:2092`) reads frontmatter, Objective, Design and two heading flags, and nothing of a plan table. The two shapes on `main` differ:

- `STORY-nothing-changed-nothing-runs.md:250`, `## Candidate Plans`, first column is a bare slug (`process-census-gate`), 18 rows.
- `STORY-the-master-agent-holds-the-fleet.md:333`, `## Plans`, first column is a markdown link to `../../plans/<date>-<slug>.md`, so the slug sits inside the link target without its date prefix.

Read the plan slugs from the first column of the table under a heading whose text ends in `Plans`, and take the slug from a link target by dropping the directory and the date prefix. Put that reader in the domain as a pure function over the story's text, so a unit test feeds it both shapes. A story with no such table reads as zero table slugs and the denominator is the plan files alone, which is today's behaviour. Do not scan the whole file for `kebab-case` words: the Design and Notes sections name many slugs that are not plans.

**Absent is not false.** A table slug with no file is *not started*, never *failed* and never dropped from the total. A story whose plans were not read (`plans: unknown`) keeps `work: null`; it must not show `0 of 18`, which would claim a total the board did not read.

### Done when

The plan's `## Notes` list is the specification:

- A unit test on the domain rule: a story declared `ready` or `active` whose every plan file is Delivered stays in Active.
- A unit test: a story whose table names 18 plans with 4 files Delivered reports 4 of 18.
- The board shows #3170 in Active with 4/18 (or 5/19).

Assertions that exist because a naive implementation would pass without them:

- A story declared `done` with plans still Draft stays in Done. It catches a cap applied to the declared status as well.
- A story declared `ready` with all plans Released stays in Active, not Archived. It catches a cap that handles `done` and forgets `archived`, the only value `derivedStanding` produces when every plan is Released.
- A `ready` story with all plans Delivered still carries the `status-behind` alert. It catches a fix made in `derivedStanding`.
- The lane test runs through `discovery-lanes` or `deriveStoryStatus` with a story whose `status` is already derived, per the second-call-site decision above.
- Both table shapes yield the same slug set for the same plans.

Also update `docs/domain/card-grammar.md` (the `status-behind` row, line 76) and the wording in `card-presentation.ts` (`PROVEN`, line 568-575) together. `scripts/check-card-presentation.sh` gates that pair, and `packages/board/test/unit/card-presentation.test.ts` asserts the strings. The `done` and `archived` phrases move from *plans delivered* to a hint form; keep `active` as it is.

Plus the repo gates: add a changeset with the description first and the `bumps:` block last, package `@plot-pm/board`, and no hand-edited versions. Do not commit a rebuilt `board-server.mjs`; `scripts/check-no-bundle-diff.sh` refuses it. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. The board is first-class and `test:board` takes the operator's board down, so do not run it locally while the board is open. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

New functions are arrows in every file you write, and a TSDoc block in `packages/domain/src/` states what the export does and returns without the history of the decision. The reasoning goes in the commit message.

### Bookkeeping

When the PR is created, open it with `plot-open-pr.sh` and append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/story-lane.ts` and a new rule file for `laneStanding` and the plan-table reader
- `packages/domain/src/rules/story-card-facts.ts`
- `packages/board/src/server/board.ts` (`deriveStoryStatus`, the `StoryCard` build near line 2338), `discovery-lanes.ts` and `story-facts.ts`
- `packages/board/src/app/lib/card-presentation.ts`, `docs/domain/card-grammar.md` and their tests
- the domain's export index for the new names

Verified against `origin/main` at dispatch: no other open branch touches the story, card or lane files. `feature/state-branch-sync` changes `packages/board/src/server/board.ts` and may touch a different region; rebase before the PR and keep this change to `deriveStoryStatus` and the story build. `feature/delivery-tab-sections`, `feature/one-pr-reader-per-machine-and` and `feature/a-merged-pending-check-is-asked-again` touch none of these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
