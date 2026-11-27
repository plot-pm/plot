# User juror: a-release-between-two-sprints-books-its-plans

Position: amend

Lens: the operator who finishes a release. For 2.37.0 that operator wrote 11 booking commits by hand (`63a5b69a9` 08:57:41 to `8843327f2` 09:00:51 +0100). The plan removes that work for the changeset-named plans and most of the rest. It does not yet say what the operator reads after a finish, and it has no route back from a wrong booking.

## Motivation facts

- True: `docs/sprints/2026-W47-plot-describes-itself.md:14` reads `- **Release:** 2.38.0`, and the sprint reads `State: Active`.
- True: `a55df0f41` is `Merge pull request #3719 from plot-pm/changeset-release/main`, 2026-11-27 08:51:59 +0100 (07:51:59 UTC; the plan says 07:52, rounded), and carries tag `v2.37.0`.
- True: the release merge deletes 15 files under `.changeset/`; 12 carry a `plan:` line naming 10 distinct plans (two each for `plot-init-checks-for-the-bb-cli` and `fleetctl-runs-in-a-submodule-checkout`).
- True: `9cb3fa3fa` (PR #3709, 2026-11-24) is an ancestor of `v2.37.0` and not of `v2.36.1`; the plan file's slice line ends `→ #3709`.
- True: `releaseScope` is at `rules/release-scope.ts:105`; the refusal block is at `workflows/release-finish.ts:144-153` (the plan says 146-153, close enough).
- Incomplete: "the finish misses this plan" omits that the finish already names it. `release-finish.ts:180-183` pushes the note `Delivered outside the sprint, named by no shipped changeset, not booked: <slugs>`. Had the finish not refused, the operator would have seen `a-held-board-shows-the-indexed-tickets` there and booked it with one `plot-deliver.mjs --release` call, not eleven. The motivation must state this, because it changes what slice 2 buys: one call saved, against a new ancestry read.

## Findings

1. Wrong booking for a multi-slice plan (rubric 2). The range arm adds a Delivered plan when "a slice" has its merge in `<prev>..<tag>`. A plan with slice A merged before the tag and slice B merged after it, delivered before the finish runs, is booked Released at this version although B did not ship. The finish reads phase at finish time, not at tag time. The same hole exists in the changeset arm today (`releaseOwes` checks phase only), and the range arm widens it. The test list in slice 2 has no such case.
2. No undo for a wrong booking (lens). `[question-range-reads-ancestry]` says "a wrong answer books one plan that a person can reject". That is false on main: `skills/plot-reject/SKILL.md:4` moves Delivered to Approved only, `plot-undeliver.sh` finds no Released route, and `git grep -i unrelease` finds no command. A hand revert of the booking commit changes a `State:` line, so `plot-state-gate.sh` refuses it with no receipt. `release-tracker.ts` has also told the plan's tracker, so the issue is closed too. The recommendation must name the real recovery or the arm must not book on the weaker evidence.
3. The operator's report is unspecified (lens). The plan names one new note (`open sprint <slug> names <version>; left open`). It does not say how the existing `Delivered outside the sprint ... not booked` note changes once the range arm exists, and it drops an Approved plan with a merged slice in range silently (`[question-delivered-only]`). The operator needs, per finish: each plan booked and by which arm (sprint, changeset, range), each candidate not booked with its reason (phase, a slice merged after the tag, already recorded), and each Delivered plan outside every arm.
4. The unnamed-sprint fallback is not addressed (rubric 3). `releaseScope` (`release-scope.ts:105-116`) puts an open sprint with empty `Release:` and `Start:` no later than the tag date in scope when no sprint names the version, and the finish then closes it. The Approach says "where no sprint names the version ... closes no sprint". Either the fallback stays (say so) or it goes (say so, and test it).
5. PR #3741 adds a refusal the plan does not name. Its changeset says the finish now refuses `shipped-unread` where no sprint names the version and the changesets cannot be read. That is the right behaviour for the operator, and the plan's Approach must record it, so slice 2 builds on the stated contract.
6. Board (lens). The `<!-- Board impact: none -->` comment holds only if `releaseUnbooked` reads the new scope in slice 2. `release-unbooked.ts:59` calls `releaseScope(version, tag.date, sprints, shipped)` with no tag range; slice 2 must pass the range reading to both callers, and a test must show the Delivery tab's `unbooked` item naming the 3709 plan. A plan the previous release missed falls out of the newest tag's range and leaves the `unbooked` item without being booked; name that case.
7. Overlap with `/plot-release` step 5b (rubric 3). `skills/plot-release/SKILL.md:52` tells the operator to read the finish's lines back and run `plot-deliver.sh --release` per plan still Delivered. After slice 2 that step must say which plans can still remain (outside both arms), or the operator keeps doing the 2.37.0 sweep by habit.
8. Slice order and checkability (rubric 4). The order is right: slice 1 is independent and shipped as #3741 with a 2.37.0 fixture. Slice 2's three tests are checkable, but the fixture needs a real git range (two tags, merge commits), not JSON readings; the plan should name that the range is read by an adapter (`Refs`) and handed to `releaseScope` as a value, per the layering rule.

## Required changes before slice 2

1. Book a range-arm plan only where every slice with a `→ #N` or merge subject has its merge commit reachable from the tag; a slice merged after the tag keeps the plan out and names it in the notes. Add that case to slice 2's tests, and apply the same check to the changeset arm or state why not.
2. Replace "a person can reject" with the actual recovery for a wrong Released booking, or file the missing un-release route as its own plan and name it here.
3. Specify the finish's notes after slice 2: booked plans with their arm, skipped candidates with their reason (including an Approved plan with a slice in range), and the remaining Delivered plans outside every arm. Make each a test assertion.
4. State whether the unnamed-open-sprint fallback in `releaseScope` survives a no-named-sprint release, and test it.
5. Record PR #3741's `shipped-unread` refusal in the Approach.
6. Make slice 2 pass the same tag-range reading to `releaseUnbooked`, add a test that the `unbooked` item names the 3709 plan, and name what happens to a plan an earlier release missed.
7. Correct the Motivation: the finish already names unbooked Delivered plans in its notes; the gap was the refusal, plus one plan not booked.
8. Update `/plot-release` step 5b to say which plans the finish can still leave and why.
