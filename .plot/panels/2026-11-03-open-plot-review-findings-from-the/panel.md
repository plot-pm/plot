# Panel: open-plot-review-findings-from-the, round 1

Outcome: unanimous amend (layering, safety, seams, testability).

## Shared findings

Each finding below was checked against `origin/main` (`a518552f1`) before the plan adopted it:

- **The slices leave design choices to an unattended agent (four of four).** Slices 1, 3 and 5 each offered two fixes joined by "or", and the two options sat in different layers or carried different blast radius. Plan: one fix per finding. Slice 1 takes the tip read in `mergeAt` (safety A2); slice 3 reads the settled state before `close-prs` (safety A6, layering).
- **The merge gate opt-in and `bypass` can open fleetd's auto-merge (safety, seams, layering).** `PrReviewReading.bypass` is any writer's `review-bypass:` comment (`ports/host.ts:159-160`), and #3068 already rejected a working-tree opt-in key. Plan: the person dropped both; `review-not-passed` stays for every caller.
- **The `unknown` bound must not write `settled` (safety, layering).** A writer-side change in `advanceSettled` (`rules/default-branch.ts:110-115`) would lift the red hold and change what `redMainStep` reads. Plan: reader-side in `merge()`, `person` only, after `Checks wait` from `headSince`.
- **A fixer-attempts version bump stalls every PR (safety, layering, testability).** `finding.kind` already exists (`entities/fixer-attempts.ts:21-23`). Plan: count by kind, version stays 1.
- **The revert number check needs no new field (safety, verified).** Layering and testability read the docstring at `rules/repair-pr.ts:33-34` and asked for a new record field; `RepairRecord.revertedPr` exists (`entities/repair-record.ts:136`) and `revert-start.ts:342` writes it. Plan: compare with `revertedPr`, correct the docstring, refuse a record without it.
- **The desk-endings fix as written starts a fresh agent on a merged desk (safety, layering, testability).** `ending-action.ts:350-353` falls through to `start-fresh`. Plan: `needs-a-person` for merged plus unpushed or unanswerable; the reading comes through `Trees.unpushedCommits` (`ports/trees.ts:457`), not the shell script.
- **No slice names its tests (testability, seams).** Plan: a `## Tests` section names a file and test name per finding, the six existing tests that change on purpose, and the check for each text-only or type-only finding.
- **"No dependency among slices" is false (layering, seams, safety).** Plan: an *Ordering* subsection and `waits:` markers on slices 1, 2 and 3.
- **Release approval and the reviewer role need a person (four of four).** Slice 5's caller fixes pull against each other (layering), the board route has no identity (safety), booking plans outside the sprint contradicts #3071 (seams), and the reviewer move has no single loader to move onto (layering). Plan: moved to #3077.

## Where jurors differed

- **The layer of the repeat-merge fix.** Layering preferred the `mergeArm` check in `slicePrNext`; safety preferred the tip read in `mergeAt`, and rejected a (PR, head) memory because it strands a PR on a transient refusal. The person chose by the safety juror: the tip read in `mergeAt`.
- **The fixer-pushed head.** Safety asked the record to name the pushed head; layering found that the record stores only the start head and called the reading a design decision. The plan proves the head from the record, never from desk state, and allows one optional field at version 1 if the existing fields cannot name it. This is the moderation's resolution, not a juror's.
- **Waits for slice 1.** Seams asked slice 1 to wait on #3068; with the tip-read fix slice 1 no longer edits `slice-pr-next.ts` or `auto-merge.ts`, so the plan names only #3074 for it, as the person asked.
- **Safety's order "slice 2 before slice 1".** It rested on slice 1 relaxing the review gate. With the opt-in dropped, slice 1 relaxes nothing for fleetd, and the order no longer follows.
- **The changelog claim.** Testability and seams asked to choose behaviour or text; layering placed it in the slice's changeset. The person chose text, through the changeset.
- **Slice 7 idle key.** Only layering noted that a slice with no `moved` line keeps one key for life. The plan states it as intended.

## What each juror ran versus read

| Juror | Ran (read-only) | Read only |
|---|---|---|
| layering | `git fetch`; `git show`/`git grep` on `origin/main` for every cited file and for `autoReview`, `Review required since`, `bypass`, `mergeAt(`, `dirtyTree`, `unpushed`, role loaders | the plan, the brief, `CLAUDE.md`; not #3069 or #2918-#2935 |
| safety | `git fetch`; `git show` excerpts of the merge, fixer, repair, ending and board caller paths; `git grep` for `bypass`, `caller:`, `close-prs`, `revertedPr`, `PLOT_UNATTENDED`; `gh issue view 3069` | the plan and the brief |
| seams | `gh pr view` on #3062, #3067, #3068, #3070, #3071, #3074; `git branch -r`; `git show` of the sibling plans | every behavioural claim about the fixes |
| testability | `git log 321966041..origin/main` over the cited paths (empty); `git show` of every cited line; `git ls-tree` for test files | every test file named; no suite ran |

No juror ran a test, a build, or a fleet, board or host write command.

## Shared blind spot

No juror checked whether the fixer attempts record can name a fixer-pushed head without a new field, and no juror read the fleet test that exercises the `holding-work` ending (`packages/fleet/test/unit/fresh-agent-tick.test.ts`). Three jurors read the stale docstring at `rules/repair-pr.ts:33-34` as fact; only safety checked the entity.

## Decisions taken by the person

jwloka, 2026-11-03:

1. No review opt-in. Slice 1 drops the opt-in and the `review-bypass:` honour. `Review required since` already decides adoption, and fleetd never honours a bypass comment. Slice 1 keeps the `unknown` bound (no `settled` write, never lifts `default-branch-red`) and fixes the repeat-merge host calls in one layer.
2. Release approval and the reviewer role leave this plan for #3077 and a Design phase.
3. The changelog read-back claim (`CHANGELOG.md:463`) is corrected in text, through the slice's changeset description, because `CHANGELOG.md` is generated.
