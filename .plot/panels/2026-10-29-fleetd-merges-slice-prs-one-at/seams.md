# Juror verdict: seams against the nine sibling plans and the story design

Position: amend

Evidence: Read the plan, `DESIGN-delivery-loop.md`, issue #2902 (`gh issue view 2902`), and all nine sibling plans (#2898, #2899, #2900, #2901, #2903, #2904, #2905, #2906, #2907). Read `packages/domain/src/workflows/merge.ts`, `rules/default-branch.ts`, `entities/default-branch.ts`, `entities/pr.ts`, `entities/pr-index.ts`, `ports/host.ts:114-150,398-408`, `rules/queue.ts:567-583`, `packages/board/src/server/entry/merge.ts`, `entry/gate.ts:615-700`, `packages/fleet/src/shared/default-branch-refresh.ts:175-215`, `registryd-main.ts:2524-2540,2863`, `packages/fleet/package.json`. Ran: an esbuild-bundled node script (`juror-2902-seams/race.ts`) that calls the real `merge()` and `defaultBranchRed()` against hand-built readings. Output: a reading-only in-flight mark reads "settled" one tick after a merge when the tip read failed, and `merge()` then decides to merge a second PR; a stale red reading gives `defaultBranchRed = false` but `merge()` refuses `default-branch-stale`. No vitest run; no suite run.

## (a) Problem statement

- Correct: fleetd merges nothing; the only caller of `mergeAt` is the board entry (`entry/main.ts:14,163`). `head-moved` exists (`workflows/merge.ts:107-109`). A reading older than `Checks wait` refuses (`merge.ts:121-125`).
- Wrong: "The merge controller has no unattended caller today. The design lifts the unattended refusal". The merge path has no unattended refusal to lift. `workflows/merge.ts:95-135` has no `unattended` refusal in `MergeRefusal` (`:11-19`); `entry/merge.ts:48-75` reads no `PLOT_UNATTENDED`; the controller gate (`gate.ts:651-700`) checks only an action receipt and the head pin for a merge. Only `restart` has one (`workflows/dispatch.ts:42-43`). The design's *Unattended callers* line (design:144) states a fact that is false for `merge`. This plan should say so, because it removes its only stated reason to wait on a caller identity.
- Conflated: "Default branch red or stale → hold (today's `default-branch-red`)". Today's `default-branch-red` is a *dispatch-queue* hold (`rules/queue.ts:583`, `HOLD_SCOPE` at `registryd-main.ts:2863`). It uses `defaultBranchRed` (`default-branch.ts:262-270`), which LIFTS on a stale reading. The merge refusals at `merge.ts:121-128` hold on a stale reading. My script shows the two disagree on the same reading. The merge arm must use the merge semantics, and the plan must cite `merge.ts:121-128`, not the queue hold.

## (b) Approach, against the siblings

1. **Wrong prerequisite for the caller identity.** The plan says "depends on #2900 for that identity". #2900 builds no caller identity. #2898 builds it (`feature/fleetd-caller-identity`, "`continue`, `restart` and `merge` lift the unattended refusal"). Since `merge` has no such refusal (above), the merge arm needs no caller identity at all when fleetd calls the workflow in-process. #2898's slice should drop `merge` from its list, or name what it gates.
2. **What this plan really needs from #2900, and does not name.** #2900 owns `rules/slice-pr-next.ts` (`feature/fleetd-reviews-slice-pr-next`, `builds: slicePrNext, the one-next-step rule`), the tick wiring that calls it, and the sprint scope reader (`feature/fleetd-reviews-sprint-scope`). This plan's slice 2 says "the tick calls the rule for each open slice PR of the scope", which is #2900's wiring plus #2900's scope reader. The plan carries no `waits:` on either branch.
3. **Duplicate `builds:` marker.** Slice 1 says `builds: slicePrNext, the merge and hold arms`. #2900 says `builds: slicePrNext, the one-next-step rule`. #2903 also adds arms to the same file. The deliverable search reads the marker's leading name; three plans claim `slicePrNext`. This plan should claim only `the merge and hold arms of slicePrNext`.
4. **The review record has no owner and no index source.** The PR index's `review` field is GitHub's review decision (`APPROVED`/`CHANGES_REQUESTED`, `entities/pr.ts:35-38`, `pr-index.ts:41`), not the `plot/review` status. The status is read only by the host call `prReview` (`ports/host.ts:146,398-408`). Under *A Decision Reads The Index*, either the index gains the `plot/review` state and its SHA, or the rule pays one host call per PR per tick. No sibling builds this. #2900 needs it first ("no review on this head"), so #2900 should own it, and this plan should name it as an input.
5. **The merge predicate excludes #2903's ticketed HIGH.** #2903's arm 3 ends "then to merge", and the design row says "merge". This plan's row is "Review on this head has no HIGH → merge". A head whose HIGH is ticketed has a HIGH, so no row of this plan merges it, and #2903 builds no merge. The predicate should be "`plot/review` is `success` on this head", which covers a clean review and a ticketed HIGH. The HIGH arms then fire on `failure`. This plan owns the predicate.
6. **The red-main hold blocks #2904's repair and revert PRs.** #2904 merges a fix-forward PR that "jumps the queue" and a revert PR "through `workflows/merge.ts`", both while main is red. `merge.ts:127-128` refuses every PR on a settled red reading, and this plan's hold row holds every PR. Neither plan names the exemption. #2904 should own it (a repair or revert PR passes the red refusal, and nothing else does). This plan should state that its hold rows leave a repair PR to #2904's rule.
7. **fleetd cannot reach `mergeAt`.** The domain workflow decides. The pinned write (`--match-head`, `canPinMerge`, `scripts.hostSaid`) lives in `packages/board/src/server/entry/merge.ts:48-75`. `packages/fleet/package.json:29` depends on `@plot-pm/domain` only. Some slice must move `mergeAt` (or its port wiring) where `packages/fleet` can import it, or fleetd re-implements it. No sibling builds this. #2904 (revert) and #2907 (release) need the same call. This plan is the first fleet merge, so it should own the move.
8. **The run log.** #2899 says "Every later loop plan writes its steps to this log". This plan does not name #2899. A merge and a hold are loop steps. If holds write no line, #2899's stall rule reads a PR that waits its turn in the merge line (up to ~100 min for ten slices, design:89) as stalled. The plan should name #2899 and say which of its steps write a line.
9. **#2905's trigger.** #2905 writes the progress line "after the merge #2902 performs". The design counts every merge, a person's too. #2905 should read MERGED rows from the index rather than hook this plan's call. This plan should say it writes nothing to the tracker (its Notes already say so) and that #2905 reads the index.

## (c) Slices

- The cut into rule then tick is right, and the order is right.
- Missing: the `mergeAt` move (b7). Put it in slice 2 or a new first slice.
- Missing `waits:` on `feature/fleetd-reviews-slice-pr-next` (slice 1) and `feature/fleetd-reviews-sprint-scope` (slice 2).
- Arm precedence across plans: one PR can match a hold row of this plan and a HIGH row of #2903 at once (HIGH, desk dead, main red). Design:71 demands exactly one next step. This plan should state that its hold rows gate only the merge step, so reviews and fixes continue while main is red. #2900 should own the order and the answer type that all arms extend.

## (d) Open questions

1. *Which reading of #2900?* Neither. The caller identity is #2898's, and the merge path needs none (a). From #2900 it needs the rule file and answer type, the review record, the scope reader and the tick wiring.
2. *Same `Default branch checks` list?* Yes, by construction. The reading folds only declared runs (`declaredRuns`, `default-branch.ts:41-45`; the refresh passes `world.checks`, `registryd-main.ts:2522`), and `settled` comes from that fold. No second list exists to diverge.
3. *Where the tick reads a person's merge?* The reading alone is not enough. I ran it: when the refresh after a merge cannot read the tip, it writes nothing (`default-branch-refresh.ts:184-188`), the file keeps `settled.sha === headSha`, green and fresh, and `merge()` decides to merge the next PR. The mark should hold unless both hold: the reading's `settled.sha === headSha`, and the reading's `at` is newer than the newest MERGED row's `mergedAt` in the PR index. Also at most one merge per tick. The index row is the "any merge, by fleet or person" signal, and the reading is the "settled" signal.
- New: does a `plot/review=success` whose description names a ticket (#2903) need its own row, or does it share the merge row? Answer proposed above: share it.
- New: what does the merge arm do on `host-refused` from `mergeAt` (`entry/merge.ts:71-73`)? A ruleset refusal repeats every tick.

## (e) Tests

- Slice 1, domain unit (vitest, `packages/domain/test/`): success on the head → merge pinned to the head; success on an older SHA → no merge; stale red and stale green → hold (assert against `defaultBranchRed` returning false on the same fixture so the two semantics cannot merge); `headSha !== settled.sha` → hold; newest `mergedAt` after the reading's `at` → hold; a ticketed-HIGH success → merge.
- Slice 2, fleet unit with fake ports: two mergeable PRs in one tick → exactly one `pr-merge` call; a merge followed by an unreadable tip → no second merge next tick; `head-moved` → no retry in that tick.

## Amendments

1. Drop "depends on #2900 for that identity". State that `merge` has no unattended refusal (`workflows/merge.ts:11-19`, `entry/merge.ts:48-75`, `gate.ts:651-700`), so the merge arm needs no caller identity. Tell #2898 to drop `merge` from its caller-identity slice.
2. Add `waits:` on #2900's `feature/fleetd-reviews-slice-pr-next` and `feature/fleetd-reviews-sprint-scope`. Name PR #2917 as #2900's plan.
3. Change slice 1's marker to `builds: the merge and hold arms of slicePrNext`.
4. Make the merge predicate "`plot/review` is `success` on this head", so #2903's ticketed HIGH merges through this arm.
5. Cite `merge.ts:121-128` for the red and stale hold, not the queue's `default-branch-red`.
6. Derive the in-flight mark from the reading and the newest MERGED row's `mergedAt`, and allow at most one merge per tick.
7. Own the move of `mergeAt` to a place `packages/fleet` can import, and name #2904 and #2907 as its other callers.
8. State that a repair or revert PR is #2904's to exempt from the red hold, and that the hold rows gate only the merge step.
9. Name #2899 and say which merge-arm steps write a run-log line, so a PR that waits its turn does not read as stalled.
