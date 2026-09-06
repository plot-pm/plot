## Implementation brief — four-files-say-what-they-are (slice: The four files are corrected)

- **Plan (canonical):** `docs/plans/2026-09-06-a-stated-state-is-one-the-domain-admits.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/four-files-say-what-they-are` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of two. Slice 1 merged as **#726** — the board's parse now refuses a state the domain does not admit, so these four files are what that refusal is about.

## The four

Verified still wrong 2026-09-06:

```
docs/stories/plot-gates/…                        status: archived
docs/stories/setup-asks-what-the-repo…/…         status: archived
docs/stories/the-board-is-blank-where-it…/…      status: archived
docs/sprints/2026-W36-a-half-landed-workflow…    Phase: Planned
```

`StoryStatusSchema` admits `draft ready active in-review paused done`. `SprintStateSchema` admits `Planning Committed Active Closed`.

## THE STORIES GO THROUGH THE TRANSITION, NOT AN EDITOR

**`archiveStory` (`transitions/story.ts:324`) writes the status and the date together** and refuses `archive-date-missing` — the refusal appears 5 times in that file.

**Editing the status by hand would trip the lint.** None of the three carries an `archived:` date, and `plot-story-lint.sh` S3 refuses `done` without one: *"done and an `archived:` date are two writes that must agree, so either alone is a half-archived story."*

**So a hand edit swaps one invalid state for three lint findings.** Run the transition.

**All three are archived in fact.** Verified: `plot-gates` **6 of 6** plans Released, `the-board-is-blank-where-it-matters` **15 of 15**, `setup-asks-what-the-repo-already-knows` **1 of 1**. `deriveStoryStatus` (`transitions/story.ts:402`) answers `archived` when every plan is released, so the derivation agrees with what the files assert by hand.

## THE SPRINT IS ONE WORD

`Planned` → `Planning`. Nothing else about it changes: it has not been touched since 2026-08-29 and none of its eight items ever became a plan.

## What this is not

**Not a status rewrite across the estate.** Four files, each measured, each named above.

**Not a change to any schema.** `archived` stays derived — `transitions/story.ts:26`: *"The six are what a person writes; `archived` is what the plans say."* What changes is that three files stop asserting by hand what the board computes.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **and the domain's own `tsc`** — `pnpm run typecheck` covers `@plot-pm/board` only, and CI runs a separate `Domain typecheck` step that has caught this gap twice today.

`./scripts/check-state-declarations.sh` and `skills/plot/scripts/plot-story-lint.sh` must both exit 0.

## Done when

- the three stories carry `done` **and** an `archived:` date, written by `archiveStory`
- the sprint says `Planning`
- `plot-story-lint.sh` exits 0
- the board's parse (from #726) accepts all four
- the gates above pass

## Do not

- **Do not hand-edit a story's status.** S3 refuses `done` without a date; the transition writes both.
- **Do not add `archived` to `StoryStatusSchema`.** It is derived, and #707 made that unrepresentable on purpose.
- **Do not touch other stories or sprints.** Four files, named above.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
