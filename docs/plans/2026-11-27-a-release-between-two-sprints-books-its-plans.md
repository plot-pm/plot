# A release between two sprints books its plans

> Where no sprint names the version, the release finish books the plans the release merge's changesets name, and every Delivered plan whose non-deferred slices all shipped first in this version's tag, and it closes no sprint.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Issue:** #3736
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-release-no-sprint-names-books-its-changesets`

## Changelog

- A release that no sprint names books its plans: the finish takes the plans its changesets name and the Delivered plans whose every slice PR shipped first in this release's tag. An open sprint that names another version is named in the finish's notes and no longer refuses it. The finish's notes name each booked plan with its source and each skipped plan with its reason.

<!-- Board impact: the Delivery tab's `unbooked` item reads the same scope with the tag reading, so it names a range-only plan such as the #3709 plan. No plan format, template or docs/plans layout changes. -->

## Motivation

The active sprint `plot-describes-itself` names `Release: 2.38.0` (`docs/sprints/2026-W47-plot-describes-itself.md:14`); the operator moved it from 2.37.0 to ship 2.37.0 without closing the sprint. Release PR #3719 (`release: 2.37.0`) merged at 07:52 UTC on 2026-11-27 as `a55df0f41`, which carries the tag `v2.37.0`. No sprint names 2.37.0, so `releaseFinish` refuses `release-scope-mismatch` (`packages/domain/src/workflows/release-finish.ts:146-153`) and books nothing. `releaseScope` already answers `named` where no sprint is in scope (`packages/domain/src/rules/release-scope.ts:124`); the refusal is the gap.

A person booked the release by hand: 11 commits `plot: release <slug> (v2.37.0)` between 07:57 and 08:00 UTC, from `63a5b69a9` to `8843327f2`. At `a55df0f41` exactly 11 plan files read `State: Delivered`, and they are the same 11 slugs. The release merge removed 15 changesets. 12 of them carry a `plan:` line, and those name 10 distinct plans. 3 carry none.

The 11th plan, `a-held-board-shows-the-indexed-tickets`, is named by no changeset. Its one slice PR #3709 merged as `9cb3fa3fa` on 2026-11-24 and carried no changeset at all. `9cb3fa3fa` lies in `v2.36.1..v2.37.0`. Without the refusal, the finish names such a plan in its notes (`Delivered outside the sprint, named by no shipped changeset, not booked`, `release-finish.ts:183`) and does not book it.

## Design

### Approach

- **Slice 1 removes the refusal.** `releaseFinish` drops `release-scope-mismatch`. Where no sprint names the version it books the plans the removed changesets name and closes no sprint. An open sprint that names another version is named in `notes` (`open sprint <slug> names <version>; left open`). Where no sprint names the version and the changesets cannot be read, the finish refuses `shipped-unread` rather than answering `already-released` (PR #3741).
- **The empty-`Release:` fallback stays.** Where no sprint names the version, an open sprint with an empty `Release:` and a `Start:` no later than the tag date stays in scope and is closed, as `release-scope.ts:113-118` reads now.
- **The tag arm uses `releaseTag`.** Slice 2 adds every Delivered plan for which `releasePr` and `releaseTag` (`packages/domain/src/rules/release-tag.ts`) resolve to this version: the first `vX.Y.Z` tag containing the last-merged slice PR is this version, and every other non-deferred slice PR is in that tag (`tag-misses-pr` otherwise). `plot-deliver.mjs --release` already asks the same rule (`packages/board/src/server/entry/deliver.ts:946-957`). No previous tag is read.
- **Slice PRs come from slice lines only.** The arm reads each slice's `→ #N` or `→ commit <sha>` through `BranchClaim`, as `releasePr` does, never from a whole-file match. This plan's own Motivation and `2026-10-23-plot-plan-meta-a-branch-heading.md:55` carry `→ #N` in prose, and neither counts.
- **The merge commit is read locally.** The PR index carries no merge commit, and `plot-deliver.mjs --release` asks `prState` per PR. The tag arm reads each PR's merge commit and time from the host-written merge subject on the default branch or a `sprint/*` branch (`rules/merge-subject.ts`), and a sprint-carried slice through `carriedRelease` (`packages/board/src/server/entry/release-chain-walk.ts:132`) and `Refs.tagsContaining`. It makes no host call. A slice with no merge subject (squash or rebase merge) keeps its plan out of the tag arm and names it in the notes; a `→ commit <sha>` slice uses that commit.
- **A booking is final.** `plot-reject` moves Delivered to Approved, no command reverses `Released`, and `plot-state-gate.sh` refuses a hand revert. So the tag arm books only a Delivered plan whose every non-deferred slice shipped first in this tag. A plan with one slice in the tag and one merged after it is not booked here.
- **The ancestry read is not gated.** `scripts/check-ancestry-decisions.sh:65` matches `merge-base --is-ancestor` and `--merged` forms, not `git tag --contains`. `releaseTag` decides, the adapter's read carries the `evidence` marker by convention, and a containment that cannot be read answers `unknown`, which books nothing.
- **Four callers read one scope.** The finish entry (`packages/board/src/server/entry/release-finish.ts:387`) and the three `releaseUnbooked` readers (`packages/board/src/server/entry/release-unbooked.ts:131`, `packages/board/src/server/release-unbooked-reading.ts:63`, `packages/fleet/src/shared/release-tick.ts:119`) pass the same tag reading, a new field on `ReleaseFinishReadings` and `ReleaseUnbookedReadings`.
- **A failed tag read books the changeset arm.** It adds the note `range-unread: the tag's slice merges could not be read, so only the sprint and changeset scope is booked`, as `shipped-unread` does, and the unbooked answer does not turn `unaskable`.
- **The finish reports its scope.** `notes` name each booked plan with its source (`sprint`, `changeset`, `tag`), each candidate not booked with its reason (`not-delivered`, `slice-after-tag`, `no-merge-subject`, `already-released`), and each Delivered plan outside every source. `/plot-release` step 5b names which plans the finish can still leave.

### Open Questions

- [ ] `[question-delivered-only]` Recommendation: the tag arm adds Delivered plans only; the changeset arm keeps its current note for a named plan in another phase.
- [ ] `[question-sprint-close]` Recommendation: the finish closes a sprint only where its `Release:` names the version, or by the empty-`Release:` fallback, as now.
- [ ] `[question-changeset-gate]` A gate that refuses a slice PR with no changeset would have caught #3709 at merge time, with no tag read, no ancestry and no final booking on weaker evidence. In 2.37.0 it would have changed 1 of 11 bookings. The tag arm also books plans in a repository that uses no changesets, which Plot's project-agnostic design must serve, and a plan whose changeset names no `plan:` line (3 of 15 in 2.37.0). Recommendation: build slice 2, and file the changeset gate as its own idea for repositories that declare changesets.

## Slices

### Shipped Scope

- `bug/a-release-no-sprint-names-books-its-changesets` — `releaseScope` answers the changeset scope where no sprint names the version, `releaseFinish` drops `release-scope-mismatch` and notes the open sprint <!-- builds: the sprint-free release scope --> <!-- tests: the 2.37.0 fixture — no sprint names 2.37.0 and an open sprint names 2.38.0 — books the 10 changeset-named plans, closes no sprint and notes plot-describes-itself; a fully booked re-run answers already-released --> → #3741

### Tag Range

- `bug/the-release-scope-reads-the-tag-range` — the tag arm of `releaseScope` over `releasePr` and `releaseTag` with slice lines read through `BranchClaim`, the local merge-commit reading for all four callers, the `range-unread` note, the finish's per-plan report, and `/plot-release` step 5b <!-- waits: bug/a-release-no-sprint-names-books-its-changesets --> <!-- builds: the tag arm of releaseScope and its local reading --> <!-- tests: the scope at a55df0f41 equals the 11 slugs booked in 63a5b69a9..8843327f2, no more and no less; a plan with one slice before the tag and one after it is not in this scope and is in the next; a prose → #N inside the range books nothing; a slice merged into sprint/s and carried into the tag is in scope; a plan whose slices all lie before the previous tag is not in scope; a sprint-named release books its sprint, changeset and tag plans once each; a failed tag read books the changeset arm and notes range-unread; real-repo tests with real tags and merge commits through the finish entry and each releaseUnbooked reader return the same slugs; the tag arm fails on any host call; the unbooked item names the #3709 plan -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.

2026-11-27: amended from panel round 1 (unanimous amend); see `.plot/panels/2026-11-27-a-release-between-two-sprints-books-its-plans/panel.md`.
