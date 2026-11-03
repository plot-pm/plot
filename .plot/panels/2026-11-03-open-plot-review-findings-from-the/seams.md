# Seams juror — open-plot-review-findings-from-the

Position: amend

Lens: overlaps with #3062 (jen), #3068 (Merger App), #3067 (unblocker), #3070 (release review/checks), #3071 (release tracker step), #3074 (pr-review writer check). All line references are against `origin/main` at `a518552f1`.

## Summary

Seven of the nine slices touch a file, a function or a decision that a sibling plan also changes. The plan says it names no `waits:` marker "because the issue gives no dependency among them" (Notes). That holds inside the issue, but not across the sprint. Two slices contradict a decision that a person already took in a sibling plan: the merge gate opt-in (against #3068) and booking plans outside the sprint (against #3071). Neither #3068, #3070 nor #3071 has an implementation branch yet (`git branch -r` finds none), so the order can still be chosen.

## Rubric

1. **Fix and sprint goal.** Each slice fixes its named finding. Slices 1, 2 and 3 move the sprint toward zero interventions, because they change the rules by which fleetd merges, fixes and repairs. Slices 5 and 6 can move it backwards if they land against #3071 or #3070 in the wrong order (see findings S5, S6). A reader verifies each fix through the test the slice adds. The plan names the test kind and does not name the test files, see rubric 6.
2. **Code claims.** The claims I checked hold: `merge.ts:209-213` (review-not-passed), `slice-pr-next.ts:385` (arm order, restatus before high), `:283`/`:295` (autoReview and start budget only in `reviewArm`), `auto-merge.ts:116` (only `host-refused` is remembered), `ending-action.ts:352`, `release-approve.ts:73`, `review.ts:345` and `:481`, `registryd-main.ts:1128-1139` (`createdAt` always `''`) and `:2557`. One drift: `auto-fixer.ts:457` calls `roleCommand` at `:461`.
3. **Breakage and half-done work.** See findings. The main risks are merge conflicts with #3068 in `auto-merge.ts`, `slice-pr-next.ts` and its test, and a semantic conflict with #3071 in `release-finish.ts`.
4. **Failure modes.** Slice 1, as written, can turn `review-not-passed` into a pass on a PR comment that any writer can post (S1). That ends in a wrong answer, not in a named refusal.
5. **Unattended build.** Slices 1, 5 and 6 each depend on an Open Question that only a person can answer. Slices 2, 3, 7, 8 and 9 can be built unattended once the `waits:` markers below exist.
6. **Tests.** The slices name the defect and "the test that fails without the fix", but not the test file or the case name. Under my lens, the gap is that the sibling plans already rewrite `packages/domain/test/slice-pr-next.test.ts:405-408` (#3068), `packages/domain/test/workflows-release-approve.test.ts` (#3070) and `packages/board/test/unit/release-finish-real-repo.test.ts` (#3071). A test this plan adds to those files must be written against their post-merge shape.

## Findings by slice

### S1 `bug/the-merge-gate-reads-adoption` — collides with #3068 and #3074

- **Contradicts a decision in #3068.** #3068 rejects "an opt-in key" because `## Plot Config` is read from the working tree (`config-reader.ts:41-44`), so a slice PR can add the key. #3068 also says `review-not-passed` "stays a controller refusal for every identity" and "no `## Plot Config` key grants a weaker merge path" (`docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md`, Approach *What stays* and Notes). S1's "`review-not-passed` honours the review opt-in" adds such a key. The slice must state why its key is not that path, or drop it.
- **`bypass` is any writer's PR comment.** `PrReviewReading.bypass` is "Whether any PR comment starts with `review-bypass:`" (`ports/host.ts:159-160`). A fleet agent, a fixer or a foreign account can post that comment. If `merge()` honours it for every caller, fleetd's `mergeTick` (`auto-merge.ts:115`) merges with no review on a comment. That is the same class of gap as #3072, which #3074 closes for `plot/review` itself. The honour must be limited to a person's `plot-ask.mjs merge` call and refused for fleetd, and it must wait for #3074's decision on how `pr-review` reports a writer.
- **Same functions as #3068.** #3068's only slice `feature/fleetd-merges-as-the-merger-app` rewrites `runAutoMergePass` (`auto-merge.ts:183`), adds `merge` and `merge-hold` records to `mergeTick`, and replaces `mergerAppMissing` in `SlicePrNextReadings`. S1 changes the no-retry memory in the same `mergeTick` (`auto-merge.ts:116`) and the read order in `mergeAt` (`merge.ts:360-367`). A memory that also covers `default-branch-unsettled` changes how many `merge` records #3068's pass appends per (PR, head); #3068's record test must still hold.
- **Docs.** `CLAUDE.md:524` (the *One hold reads a non-terminal answer* paragraph) states when `default-branch-unsettled` refuses. A bound for an `unknown` settled reading changes that text; `AGENTS.md` follows through `./scripts/check-agents-md.sh --write`. `docs/review-status-rollout.md:146-151` gets a fleetd column from #3068 and a review-opt-in row from S1.

### S2 `bug/a-high-gets-its-own-fixer-attempts` — collides with #3068, raised by #3070

- **Same file and test as #3068.** S2 reorders the arm list at `slice-pr-next.ts:385` and changes `restatusArm` (`:177-190`). #3068 changes `mergeArm` (`:346`) and `SlicePrNextReadings` in the same file, and rewrites `slice-pr-next.test.ts:405-408`. S2 needs `waits: feature/fleetd-merges-as-the-merger-app`.
- **#3070 makes the latent finding live.** #3070 Decision 1 sets `Auto-review: true`, which "turns on fleetd's review of every slice PR". After that, every slice PR can get HIGH findings, so the shared count of two in `rules/fixer-attempts.ts:26-37` decides live PRs. S2 should land before or with #3070's `feature/the-release-review-is-switched-on`, and the plan should say so.
- **Docs.** The `slicePrNext` paragraph in `CLAUDE.md` (*A Decision Reads The Index*, "One rule reads a non-terminal answer…") names the arms by issue; it needs no change unless the arm order is named there. The JSDoc arm numbers at `slice-pr-next.ts:169-301` ("Arm 3", "Arm 5") change with the order.

### S3 `bug/a-red-main-stays-acted-on` — collides with #3068, touches CLAUDE.md

- **#3068 adds a repair-arm test** with a repair PR and a revert PR that `repairMerge` admits. Once S3 makes `isRevertBranch` compare the PR number (`rules/repair-pr.ts:66-70`), every fixture with a `bug/revert-<n>` branch whose `<n>` does not match fails. #3068 also edits `entities/repair-record.ts:18-20`. S3 needs `waits: feature/fleetd-merges-as-the-merger-app`, or #3068's fixtures must use a matching number.
- **Docs.** `CLAUDE.md:524` says the admitted PR's head branch is `bug/main-repair-<12 hex of lastGreenSha>` or `bug/revert-<pr>`. It must state the number check. The `plot-ask.mjs repair-pr` sentence at `CLAUDE.md:538` names the same branch rule. `AGENTS.md` follows.

### S4 `bug/holding-work-reads-unpushed-commits` — no sibling collision

- No sibling plan touches `ending-action.ts` or `agent-loop.ts`. #3067 changes `continueOnDesk` and the answer record, not the ending table.
- If the new "no commit ahead of upstream" reading comes from `plot-worker-state.sh` (`:527-531`), `scripts/check-shell-lines.sh` requires an equal removal of shell lines. The slice should say where the reading comes from.

### S5 `bug/the-release-books-what-it-ships` — collides with #3071 and #3070

- **Contradicts #3071's scope.** #3071 states: "Plans outside the sprint stay out of scope (decided) … That is #2927 finding 2, tracked in #3069, and this plan does not change it." #3071 also adds `release-scope-mismatch` to `releaseFinish` and a tracker step whose sibling read assumes that "a Delivered plan outside the booking that names the same issue does keep it open". If S5 books plans outside the sprint, #3071's tracker step closes their issues too, and its sibling-read test (plan C outside the sprint keeps `#999` open) changes meaning. S5 must `waits:` on both #3071 slices (`bug/release-finish-refuses-another-sprint`, `bug/release-approve-tells-its-tracker`) and restate the tracker interaction.
- **"Books or names" is undecided.** The slice line offers both. Which one belongs to a person. How the finish finds "a Delivered plan whose changesets ship under the tag" is also unstated: the changeset `plan:` line is optional (CLAUDE.md *Versioning*: "0 of 19 carried one"), so the match is not mechanical.
- **Same function as #3070.** #3070 adds `checks-missing` and `release-head-foreign` to `releaseApprove` (`release-approve.ts`), and its tests in `workflows-release-approve.test.ts`. S5's caller rule (Open Question 2) changes the same refusal list. Three plans now edit the `release-approve` sentence in `CLAUDE.md:538` (it lists `unattended`, `unaskable`, `not-release-pr`, `head-moved`, `review-missing`): #3070, #3071 and S5.
- **Enforcing who may approve conflicts with the sprint target.** The sprint's target is "one approval for the release", and `CLAUDE.md:538` names `plot-ask.mjs release-approve` as the route. A master agent in the person's session and the person run the same command with the same environment; the plan names no reading that tells them apart. That decision is a person's.
- **Board routes.** `deliver.ts:791-794` is in the file from which #3071 extracts the tracker step (`deliver.ts:913-969` into `entry/release-tracker.ts`). The regions differ, so the conflict is textual only.
- **Split.** The caller fix for the board routes (#2918, LOW) has no seam and can ship alone. The booking fix and the approver rule should be separate slices.

### S6 `feature/the-reviewer-is-a-role-agent` — collides with #3070, #3074 and #3067

- **#3070 makes the reviewer start live for every slice PR** (`Auto-review: true`). The security claim that S6 restores then covers every fleet review, so its order against #3070's first slice matters.
- **#3074 decides which writer's `plot/review` counts.** `rules/role-gate.ts:2` and `:69` name the reviewer as the one role that may write `plot/review`. Moving the reviewer onto `roleCommand` must keep that exception and the identity #3074 compares against.
- **#3067 also starts a role through `roleCommand`** (`rules/role-command.ts:62`) for the unblocker. Both change the role start; one should wait for the other.
- **Same file as S9.** S6 changes `review.ts:345`, and S9 changes `review.ts:481` and `review.test.ts`. A `waits:` between S6 and S9 avoids two desks on one file.
- Open Question 3 (a Design phase first) is a person's decision; I agree it needs one.

### S7 `bug/an-idle-episode-survives-a-restart` — textual collision with #3067

- #3067 slice 1 exports the tick options builder from `registryd-main.ts` and passes an `UnblockWorld`. S7 changes `registryd-main.ts:2557` and the `createdAt` comment at `:1128-1139`. The conflict is textual; a `waits: feature/fleetd-starts-the-unblocker` or a note suffices.

### S8 `bug/the-plan-comment-parses-what-it-wrote` — feeds #3071, one finding missing

- #3071's tracker step calls `plot-plan-state.sh` once per booked plan, which reaches `githubPlanStateWrite` in `tracker-plan-state.ts` with its per-issue lock and shared hash file. S8 fixes the lock race and the non-atomic hash file on that path, so S8 should land before #3071's `bug/release-approve-tells-its-tracker`, or the plan should say the order does not matter because #3071 writes plans one after another.
- The slice line lists five fixes, and the Approach lists six findings for #2935. The CHANGELOG claim (`CHANGELOG.md:463`) is missing from the slice line. `CHANGELOG.md` is generated by changesets, so the slice must state whether it changes the code to match the published claim, adds a test that checks the claim, or leaves the published entry alone.

### S9 `bug/the-review-comment-tests-can-fail` — shares a doc with #3068 and #3070

- `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md` is edited by #3068 (`:37`) and by S9 (`:53`). Line 53 also says fleetd "never calls" `plot-review`, which #3070's `Auto-review: true` makes false. S9 should correct both halves of `:53`, or #3070 should, and the plan should say which.
- Same file as S6, see above.

## Required amendments

1. Add `waits:` markers: S1, S2 and S3 on `feature/fleetd-merges-as-the-merger-app` (#3068); S5's booking part on both #3071 slices; S6 on #3070's `feature/the-release-review-is-switched-on` and #3074's `feature/pr-review-accepts-a-plot-review`; S9 on S6 (or the reverse); S7 on `feature/fleetd-starts-the-unblocker` (#3067). Replace the Notes sentence "the slices name no `waits:` marker" with the cross-plan order.
2. S1: state that `bypass` is any writer's comment (`ports/host.ts:159-160`) and limit its honour to a person's `plot-ask.mjs merge` call, with a test that fleetd's `mergeTick` still refuses `review-not-passed` on a PR that carries a `review-bypass:` comment. Reconcile the review opt-in with #3068's rejected opt-in key, or drop it.
3. S2: state that #3070's `Auto-review: true` makes #2923 live and order S2 before that slice.
4. S5: split into (a) board release and restart routes pass the person as caller, (b) Delivered plans outside the sprint, waiting on #3071 and naming how it reads "ships under the tag", (c) who may approve, after the person's decision. Name the one `CLAUDE.md:538` sentence that #3070, #3071 and S5 all edit.
5. S8: add the CHANGELOG finding to the slice line and say what changes.
6. Name the docs each slice touches (list below), including `./scripts/check-agents-md.sh --write` wherever `CLAUDE.md` changes.
7. Correct `auto-fixer.ts:457` to `:461`.

## Docs and skills each slice touches

| Slice | Docs and skills |
|---|---|
| S1 merge gate | `CLAUDE.md:524` (`default-branch-unsettled`), `AGENTS.md`, `docs/review-status-rollout.md:146-151` |
| S2 fixer attempts | JSDoc arm numbers in `slice-pr-next.ts:136-320` |
| S3 red main | `CLAUDE.md:524` and `:538` (revert branch rule, `repair-pr`), `AGENTS.md`, `entities/repair-record.ts` comment (shared with #3068) |
| S4 desk endings | none, unless the reading is new shell (then the shell-lines ratchet) |
| S5 release approval | `CLAUDE.md:538` (`release-approve` refusals), `AGENTS.md`, `skills/plot-release/SKILL.md` step 5b and its Model Guidance row (also edited by #3071), changeset bump for `plot-release` |
| S6 reviewer role | `.claude/agents/reviewer.md`, `rules/role-gate.ts` header, `docs/review-status-rollout.md` (reviewer identity), `DESIGN-delivery-loop.md` |
| S7 idle slice | `registryd-main.ts:1128-1139` comment |
| S8 plan comment | `plan-issue-comment.ts:74-77` docstring, `CHANGELOG.md:463` decision |
| S9 review comment | `DESIGN-delivery-loop.md:53` and `:155`, `rules/review-issue.ts:4` |

## Decisions that need a person

- S1: whether any opt-in exists, given #3068 rejected a working-tree key; and whether `bypass` counts for a person's merge only.
- S5: book or name the plans outside the sprint; and whether who-may-approve is enforced, given the sprint target routes the one release approval through `release-approve`.
- S6: Design phase first (Open Question 3).

## What I ran and what I only read

Ran (read-only): `gh pr view` on #3062, #3067, #3068, #3070, #3071, #3074 (files and branches); `gh pr list --state open`; `git fetch`; `git branch -r` for implementation branches of the sibling plans (none found); `git show` of the sibling plans on `origin/main` and on their idea branches; `git show`/`git grep` on `origin/main` for `auto-merge.ts`, `merge.ts`, `ports/host.ts`, `slice-pr-next.ts`, `release-approve.ts`, `role-command.ts`, `role-gate.ts`, `review.ts`, `registryd-main.ts`, `tracker-plan-state.ts`, `tracker-github.ts`, `ending-action.ts`, `agent-loop.ts`, `DESIGN-delivery-loop.md`, `CLAUDE.md`.

Only read, not executed: every behavioural claim about the fixes. I ran no test, no build and no fleet or board command. The textual-conflict findings are predictions from the files each plan names, not a trial merge.
