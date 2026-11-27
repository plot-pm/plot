# Estate juror

Position: amend

Subject: `docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md` at `origin/main` (Approved 2026-11-27, #3736). Lens: does the plan fit the code that exists.

## 1. Motivation facts

- True: `docs/sprints/2026-W47-plot-describes-itself.md:14` reads `- **Release:** 2.38.0`, and `:7` reads `State: Active`.
- True: `a55df0f41` is `Merge pull request #3719 from plot-pm/changeset-release/main`, committed 2026-11-27 08:51:59 +0100 (07:51:59 UTC), and `v2.37.0^{commit}` resolves to it.
- True: `releaseFinish` refuses `release-scope-mismatch` at `packages/domain/src/workflows/release-finish.ts:146-153`, and `releaseScope` is at `packages/domain/src/rules/release-scope.ts:105`.
- True: 11 commits `plot: release <slug> (v2.37.0)` run from `63a5b69a9` (08:57:41 +0100) to `8843327f2` (09:00:51 +0100).
- True: `git show -m --first-parent --name-status a55df0f41` deletes 15 `.changeset/*.md`; 12 carry `plan:`, naming 10 distinct plans; 3 carry none (`the-board-reader-reads-main`, `the-pr-age-counts-from-the-last-read`, `the-pr-age-follows-the-rows-served`).
- True: `9cb3fa3fa` is the #3709 merge (2026-11-24 23:52 +0100), lies on the first-parent line of `v2.36.1..v2.37.0`, touches no `.changeset/` file, and `docs/plans/2026-11-23-a-held-board-shows-the-indexed-tickets.md:52` ends `→ #3709`.

## 2. Does the design book exactly what shipped

- Defect: the range arm admits a Delivered plan with "a slice" whose merge lies in the range. A plan whose first slice merged in `v2.36.1..v2.37.0` and whose last slice merged after `v2.37.0` reads Delivered by the time a late or repeated finish runs, and the arm books it as 2.37.0. The re-run bullet ("a finish for 2.36.1 names only plans whose merges lie in `v2.36.0..v2.36.1`") has the same hole. The scope must require every non-deferred slice to be contained in the tag.
- Defect: the arm reads `→ #N` with no stated source. A whole-file read matches prose. Measured with a full-text read of `→ #N` over every plan on `origin/main` against the 23 PR merges in `v2.36.1..v2.37.0`: `2026-10-23-plot-plan-meta-a-branch-heading.md:55` holds `→ #3712` in prose (that plan is Released, so it is harmless today), and this plan's own Motivation holds `→ #3709`. Once this plan reads Delivered, a 2.37.0 re-run would book it as 2.37.0. The arm must read slice claim lines through `BranchClaim`, as `releasePr` does (`packages/domain/src/rules/release-tag.ts`).
- Defect: "on the first-parent line" misses every slice that merged into a `sprint/*` base. The base merge shows only `Merge pull request #<sprint PR> from plot-pm/sprint/...` on main's first-parent line (`1836b4e48` #3636, `c4bd296ea` #3460, `6892025e2` #3386, `fcc3c51b1` #3380, `429ede68c` #3277). The slice merges sit on the second parent. `carriedRelease` (`packages/board/src/server/entry/release-chain-walk.ts:132`) exists to follow exactly that hop.
- Gap: squash-merge or rebase-merge repositories and `→ commit <sha>` slices produce no merge subject, so the arm finds nothing. That is safe because subjects are positive evidence only, but the plan should name the fallback (changeset arm only, plus the existing `Delivered outside the sprint ... not booked` note at `release-finish.ts:183`).
- Holds: the changeset arm keeps `releaseOwes(..., false)` (Delivered only, `release-scope.ts:139-143`), so a plan whose changeset shipped while another slice is open reads Approved, is noted (`release-finish.ts:169-176`), and is not booked. The Delivered-only recommendation in `[question-delivered-only]` is right.

## 3. Duplication and contradiction

- Duplicate: `releaseTag` (`packages/domain/src/rules/release-tag.ts:137`) already answers "which tag shipped this plan". It takes the last-merged PR's first containing `vX.Y.Z` tag, refuses `tag-misses-pr` where another PR is not in that tag, and handles sprint carriage through `carrier`. `plot-deliver.mjs --release` calls it (`packages/board/src/server/entry/deliver.ts:946-957`) with `Refs.tagsContaining` and `carriedRelease`. The range arm is a second answer to the same question with weaker semantics (any slice, first-parent only). The arm should be "a Delivered plan whose `releaseTag` resolves to this version", read with local merge commits, and not a new range walk. If a local-only variant is kept, a corpus pair must hold it against `releaseTag` (CLAUDE.md, "A Shell Script Asks The Domain").
- Contradiction: `[question-range-reads-ancestry]` says the gate covers the read. `scripts/check-ancestry-decisions.sh:65` matches only `merge-base ... --is-ancestor`, `--no-merged` and `--merged`. It does not see `git log A..B`, `rev-list` or `tag --contains`, so the marker would be voluntary.
- False bound: "a wrong answer books one plan that a person can reject". `plot-reject` moves Delivered back to Approved (`skills/plot-reject/SKILL.md`). No command reverses `Released`. Booking is a phase flip, the irreversible class that "One Answer To 'Did This Land'" keeps away from subject-only evidence. The safe statement: the arm only assigns a release to a plan whose delivery the host already confirmed.
- Unstated: `releaseScope` keeps the open empty-`Release:` sprint fallback (`release-scope.ts:113-118`). The Approach bullet "where no sprint names the version, the scope is `named`" contradicts it as written.
- Under-counted: "One scope function, two callers". `releaseUnbooked` has three readers (`packages/board/src/server/entry/release-unbooked.ts:131`, `packages/board/src/server/release-unbooked-reading.ts:63`, `packages/fleet/src/shared/release-tick.ts:119`), and `releaseFinish` has its entry (`packages/board/src/server/entry/release-finish.ts:387`). Each needs the new reading, so the `Board impact: none` comment is wrong about readers.
- Related, not contradicted: `skills/plot-release/SKILL.md:347-357` selects delivered plans by the last tag's date. That is a third reading of the same scope and the plan should name it.

## 4. Slices

- Slice 1 done-when is checkable. The 2.37.0 fixture asserts 10 plans booked, no sprint closed, a note naming `plot-describes-itself`, and `already-released` on a re-run. PR #3741 touches `release-finish.ts`, a fixture under `packages/domain/test/fixtures/release-2-37-0/`, and the finish and unbooked tests, which matches.
- Slice 2 done-when is checkable, but it misses the cases above. Order is right: slice 2 waits on slice 1, and slice 1 removes the refusal that blocks any use of slice 2.
- Slice 2 names no port operation. `Refs` already has `tagsContaining` (`packages/domain/src/ports/refs.ts:884`), `contains` (`:815`) and `commitSubjects`. Name the ones used, and name the reading field on `ReleaseFinishReadings` and `ReleaseUnbookedReadings`.

## 5. Required changes before slice 2 starts

1. Define the range arm as "every non-deferred slice of a Delivered plan is contained in the tag, and the first tag containing its last-merged PR is this version", and build it on `releaseTag` / `releasePr`, not on a new first-parent range walk.
2. Read slice PRs from claim lines through `BranchClaim`, never from a whole-file `→ #N` match. Add a test in which a prose `→ #N` inside the range books nothing.
3. Drop "on the first-parent line". Resolve sprint-carried slices through `carriedRelease` or `tagsContaining`, and add a test for a slice merged into `sprint/*` and carried into the range.
4. Add tests: a plan with one slice in range and one merged after the tag is not in scope; a plan with all slices before the previous tag is not in scope.
5. Rewrite `[question-range-reads-ancestry]`: the gate does not match the read, and `Released` has no reject path. State the actual bound, which is Delivered-only plus host-confirmed delivery.
6. State that the open empty-`Release:` sprint fallback at `release-scope.ts:113-118` stays.
7. Name the three `releaseUnbooked` callers and the finish entry as consumers of the new reading. Specify that a failed range read books the changeset arm and adds a note, as `shipped-unread` does (`release-finish.ts:166-167`), and does not turn the unbooked answer `unaskable`. Correct the board-impact comment.
8. If a previous tag is still needed, restrict it to `vN.N.N`. `git describe --tags --abbrev=0 v2.37.0^` answers `plot-idea@2.6.2` in this repository.
9. Name the fallback for squash and rebase merges and for `→ commit <sha>` slices.
