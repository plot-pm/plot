# Testability juror: a-release-between-two-sprints-books-its-plans

Position: amend

## Motivation facts

- True: `docs/sprints/2026-W47-plot-describes-itself.md:14` reads `- **Release:** 2.38.0`, and the sprint reads `State: Active`.
- True: `a55df0f41` is `Merge pull request #3719 from plot-pm/changeset-release/main`, committed 2026-11-27 08:51:59 +0100 (07:51:59 UTC), and `git tag --points-at a55df0f41` lists `v2.37.0`.
- True: `release-finish.ts:146-153` holds the `release-scope-mismatch` refusal, and `release-scope.ts:105` is `export const releaseScope`.
- True: `git log --grep='(v2.37.0)'` lists 11 commits from `63a5b69a9` (07:57:41 UTC) to `8843327f2` (08:00:51 UTC).
- True: the release merge deletes 15 changesets; 12 carry `plan:` and name 10 distinct plans; 3 (`the-board-reader-reads-main`, `the-pr-age-counts-from-the-last-read`, `the-pr-age-follows-the-rows-served`) carry none.
- True: `9cb3fa3fa` (#3709, 2026-11-24 23:52 +0100) is on the first-parent line of `v2.36.1..v2.37.0`, and the plan's slice line ends `→ #3709`.
- Imprecise: the Approach says "where no sprint names the version, the scope is `named`". That is already the current behaviour: `releaseScope` returns `named` from `namedOutsideScope(shipped, [])` when no sprint is in scope (`release-scope.ts:124`). The only blocker is the refusal in `release-finish.ts`. PR #3741 touches only `release-finish.ts` in `src/`, which confirms this. The plan also does not mention the fallback at `release-scope.ts:113-118` (an open sprint with an empty `Release:` and `Start:` no later than the tag date becomes the release's sprint).

## The 2.37.0 range as an oracle

- Measured: at `a55df0f41`, exactly 11 plan files read `State: Delivered`, and they are the 11 slugs booked by hand. The 23 `Merge pull request` commits on the first-parent line of `v2.36.1..v2.37.0` map only to those 11 plans, or to branches no plan names (#3733, #3723, #3708, idea/ branches, the release PR, and the sprint merge #3636).
- So the strongest test for slice 2 is equality: the 2.37.0 scope equals the set of slugs in the 11 `plot: release <slug> (v2.37.0)` commits, no more and no less. A test that only asserts "a-held-board-shows-the-indexed-tickets is in scope" passes while the arm also books extra plans.

## Findings on correctness, each with the test that would catch it

1. Delivered at finish time is not shipped at tag time. The range arm takes "every Delivered plan with a slice whose merge lies in `<prev>..<tag>`". A plan with slice A merged before the tag and slice B merged after the tag reads Delivered when the finish runs late, and the arm books it as Released in a version that does not carry B. Test: a real-repo fixture with tag `v1.1.0` between the two slice merges, the plan Delivered after both; expect the plan not in the `v1.1.0` scope, and in the `v1.2.0` scope. The rule must require every non-deferred slice of the plan to have its merge commit reachable from the tag, and at least one in the range.
2. The first-parent restriction misses slices that landed through a sprint branch. A slice PR into `sprint/<name>` has its merge commit on the sprint branch; main gets one merge (`1836b4e48`, #3636 here) whose second parent carries the slice merges. `git log --first-parent v2.36.1..v2.37.0` lists only #3636. In 2.37.0 the sprint merge carried no slices (`git log 1836b4e48^1..1836b4e48^2` shows 10 `sprint:` commits), so the 2.37.0 fixture cannot detect this. Test: a fixture where a slice merges into `sprint/s`, `sprint/s` merges into main, then the tag; expect the plan in scope when no sprint names the version.
3. A changeset and a slice can disagree. A changeset whose `plan:` names plan X can ship while X still has an open slice (X reads Approved, so the current note applies), or name the wrong plan. The union of both arms means the changeset arm wins in either case. Test: changeset names X, X Delivered but X's only slice merged after the tag; expect X not booked, or, if the plan keeps the union, expect a note naming the disagreement. The plan must state which arm decides.
4. Negative acceptance lines pass with the arm absent. "A plan whose merge lies before v2.36.1 is not" and "an Approved plan in the range is not booked" both pass today, before slice 2 exists. Only the 3709 case and the equality oracle above fail before the change.
5. The range read is an adapter, and a domain test with an injected reading cannot prove it. `releaseScope` takes readings as values. The plan names no reading type and no adapter, and two callers need it: `board/src/server/entry/release-finish.ts` and `fleet/src/shared/release-world.ts` (`releaseUnbookedReadingsFor`). A domain test passes while one caller passes an empty range. Test: `packages/board/test/unit/release-finish-real-repo.test.ts` with real tags and real merge commits, and a `release-unbooked` reading test over the same repo, asserting both callers return the same slugs.
6. "No host call" needs a proof. The convention here is a test that fails on any host call (`impl-status-index.test.mjs`, "a fully merged plan is answered from the store with no host call"). Add the same for the range arm.
7. The open question on ancestry is not gated as described. `check-ancestry-decisions.sh:65` matches `merge-base --is-ancestor` and `--merged` forms only; a `git log <prev>..<tag>` read does not match, so declaring it `evidence` changes nothing a gate checks. Finding 1's "reachable from the tag" check would be an ancestry call and would match; name that call `evidence` and say what decides.
8. "Previous tag" is underspecified for testing. The tag commit also carries `plot-board@0.3.1`, `plot@2.32.0`, `plot-idea@2.6.2`, `plot-init@0.11.0`. Tests must cover: `v*` only, an `-rc.N` tag between releases (`plot-release` step 2B excludes RC tags), and a first release with no previous tag.
9. A release that a sprint does name loses nothing and gains the range. Test: a sprint naming the version with plan S, a changeset naming plan C, and a range-only plan R; expect S, C and R booked, the sprint closed, and no duplicate when R is also a sprint member.

## Duplication and order

- No contradiction with `release-tracker.ts` or `plot-deliver.mjs --release`: they book one named plan and do not compute a scope. `plot-release` step 2B already collects "delivered plans since the last tag" in prose; the range arm should be the one answer it reads, or the plan should say why not.
- Slice order is right: slice 1 removes the refusal and is test-complete (PR #3741 adds the 2.37.0 fixture, the 10-plan booking and the `already-released` re-run). Slice 2 depends on it.

## Required changes before slice 2 starts

1. Restate the Approach for slice 1 as "remove `release-scope-mismatch`", since `releaseScope` already answers `named` with no sprint in scope.
2. Require for the range arm that every non-deferred slice of the plan merged at or before the tag, with at least one merge in the range; add the two-slice fixture (finding 1).
3. Drop "on the first-parent line", or define how slice merges inside a sprint-branch merge count; add the sprint-branch fixture (finding 2).
4. State which arm decides when a changeset and the plan's slices disagree, and add that fixture (finding 3).
5. Make the 2.37.0 acceptance an equality: the scope equals the 11 hand-booked slugs from `63a5b69a9..8843327f2` (finding 4).
6. Name the reading type and its adapter, and require a real-repo test through both callers plus a no-host-call test (findings 5, 6).
7. Fix the ancestry open question to name the call that the gate actually matches (finding 7).
8. Specify the previous-tag rule for package tags, RC tags and a first release, each with a test (finding 8).
9. Add the sprint-named release case to slice 2's tests (finding 9).
