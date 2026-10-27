# Lifecycle juror — plot-undeliver-never-refuses-refs-swept

Lens: what `plot-undeliver.sh` and `/plot-reject` do before and after for a delivered plan whose slice refs were swept; how auto-deliver's `Rejected:` hold, the sprint file and the board read the result; what the operator sees.

Position: amend
Evidence: ran plot-undeliver.sh on Delivered copies of an old-format plan (2026-08-28-a-board-names-the-repo-it-serves) and a `## Slices`-format plan (2026-09-01-a-refused-dispatch-asks-for-a-brief) in a throwaway repo with a local bare origin (ref absent, ref present, origin unreachable); piped a `git commit` hook payload through plot-state-gate.sh after a successful undeliver; ran plot-plan-meta.sh on the Slices plan; `git ls-remote --heads origin`; `gh pr list --head bug/plot-host-bitbucket-pr-list-reads`; `gh api repos/plot-pm/plot --jq .delete_branch_on_merge`; grep counts over docs/plans. Read plot-undeliver.sh, plan.ts `undeliver`, plan-undeliver.ts, auto-deliver.ts `holdFromRejection`, plan-store-shell.ts, state-transition.ts `owningCommand`, plot-reject/SKILL.md, plot-sprint-release.sh `plan_delivery`, undeliver-two-format-scan.test.mjs.

## (a) Problem statement

The mechanical cause is correct, and I reproduced it. A Delivered copy of a `## Slices` plan whose three branches have no ref on origin decides `→ Approved` (exit 0), because `plot-undeliver.sh:79` greps `(Branch: ` only.

The title overstates the problem. The script does refuse `refs-swept` today for an old-format plan: the same run on the old-format copy exited 1 with `refs-swept` naming `bug/a-board-names-the-repo-it-serves`. 361 plans in `docs/plans/` still carry `(Branch: `, 360 of them in `delivered/`. So the defect is "reads only the old format", not "never refuses".

The motivating case is not a swept ref in the sense the rule describes. `bug/plot-host-bitbucket-pr-list-reads` is PR #2422, MERGED 2026-10-26T14:19:47Z, and the repository has `delete_branch_on_merge: true`. `git ls-remote --heads origin` returns 10 heads in total (main, the release branch, 8 open work branches). The ref is gone because the work landed, not because the work was lost. The domain's sentence for `refs-swept` — "Returning it to Approved would name work that no longer exists anywhere" — is false for a merged branch: the work exists on main.

So the plan states the right mechanism with measured facts, but it measures the wrong thing as the failure. The `→ Approved` decision in the #2760 panel case was the correct outcome for that plan.

## (b) Does the approach solve it without a new defect

No. It introduces three operator-visible defects.

1. **`/plot-reject` stops working for every delivered plan on this estate.** A delivered plan has, by construction, every non-deferred slice merged, and with `delete_branch_on_merge: true` every merged slice has no ref. Step 1 makes the script read those branches; step 3 routes `/plot-reject` through the script and makes its refusal final. Result: every rejection refuses `refs-swept`. Verified on the old-format copy, which already takes this path. The domain's own repair advice ("restore them, or write a new plan") makes no sense for a merged branch. The skill's own step 3 "Special case" (all branches merged → confirm, then reject) becomes unreachable.
2. **An unreachable origin reads as swept.** With origin pointed at a missing path and the ref present on the real remote, the script refused `refs-swept` and named the branch as "already deleted". `ls-remote` exit 128 and exit 2 are not separated. This is the "the index never says no" failure in another place: an unanswered question becomes a negative answer, and the operator gets a false sentence.
3. **A deferred slice reads as swept.** `plot-plan-meta.sh` `branches` includes `<!-- deferred -->` branches (its header says so, and the plan copy shows it). A deferred branch that was never created has no ref, so any plan with a deferred slice refuses.

Also, the refusal names `plan ''`: `plan-undeliver.ts` `slugFrom` reads a `Slug:` field no plan carries. The operator sees `plot-undeliver: plan '' has branches…`. The script knows the slug and could pass it.

## (c) Slices: missing, wrong, out of order

- **Slice 1 must narrow the swept reading before it widens what is read.** A swept branch is one with no ref AND no merged PR (`plot-pr-merged.sh`, the one answer to "did this land"), excluding deferred slices, and an `ls-remote` that fails to answer is `unknown`, not swept. Without this, slice 1 converts every delivered plan that does not use `(Branch: ` (up to 237 of 597 in `delivered/`, not counted individually) from `→ Approved` into a refusal.
- **Slice 1's test cases are incomplete.** The plan names "ref gone → refs-swept" and "refs exist → Approved". It needs "ref gone, PR merged → Approved", "deferred slice with no ref → Approved", and "origin unreachable → not refs-swept". The second named case is not the realistic one: on this estate a delivered plan never has its refs.
- **`plot-plan-meta.sh` has no `slices[].branch`.** Its JSON has `branches` (both formats, sorted, deferred included) and `waves[].branches[]` (with the `deferred` flag). The plan's example names a field that does not exist; slice 1 should name `waves[].branches[]` so the deferred flag comes with the branch.
- **Slice 2 drops the receipt and the gate refuses the commit.** `plot-undeliver.sh` leaves no receipt (0 occurrences of `receipt` in the script). After a successful run, a `git commit` payload through `plot-state-gate.sh` exited 2: "Delivered -> Approved, written by hand. The command that owns this write: /plot-approve newfmt". The plan's open question 1 is answered by measurement: the receipt is missing. Either the script writes the receipt (and `owningCommand` in `state-transition.ts` maps Delivered→Approved to `/plot-reject` or `plot-undeliver.sh`), or `/plot-reject` keeps `plot-state-receipt.sh`. The gate's current advice points the operator at `/plot-approve`, which is the wrong command. That mapping belongs in slice 2.
- **Slice 2 says "steps 4–5", but the script performs only step 4.** Step 5 moves the `delivered/` symlink to `active/`; `plot-undeliver.sh` writes only the plan file. If slice 2 replaces step 5 too, the symlink stays in `delivered/`, and `plot-sprint-release.sh` `plan_delivery` (phase `approved`, symlink present) scores the item `true`, so the sprint counts a rejected plan as delivered. Slice 2 must keep the symlink move after a successful script run, and state that order.
- **Slice 2 must say what the operator does on `refs-swept`.** Today the only exit is the hand edit the slice removes. If the narrowed rule fires (genuinely lost unmerged work), the skill should print the refusal, leave the plan Delivered, and say "write a new plan for the lost work".
- **Step 4's `Delivered:` line handling differs.** The skill replaces `Delivered:` with `Rejected:`; the script keeps `Delivered:` and inserts `Rejected:` above it (verified in the diff). `holdFromRejection` and `statusField` read by name, so the hold still fires. The skill text in step 4 and the summary in step 8 must describe what the script writes, not the old hand edit.
- **Pre-existing skill errors slice 2 touches anyway:** step 3 reads "heading containing Branches" (current plans use `## Slices`), and step 6 says "the plan file carries `State: Rejected`", while the script writes `Approved`. With `Approved`, `plan_delivery` scores `withdrawn` never; the sprint item reads `open` after the symlink moves. The step 6 text should match that.

## (d) Open questions a person must decide

1. **Merged-and-deleted branch: swept or not?** Either `refs-swept` counts only branches with no ref and no merged PR, or it counts every branch with no ref and `/plot-reject` cannot reverse a fully merged delivery. Recommendation: the first. The second makes `/plot-reject` unusable on any repo with `delete_branch_on_merge: true`, including this one.
2. **Receipt owner.** Either `plot-undeliver.sh` writes the receipt and becomes a named owner in `owningCommand`, or `/plot-reject` keeps `plot-state-receipt.sh --unowned`. Recommendation: the script writes it; the plan's goal is a controller, and an `--unowned` receipt after a controller run keeps the gap countable for no reason.
3. **Who moves the index symlink.** Either `plot-undeliver.sh` moves `delivered/<slug>.md` to `active/` in the same write, or `/plot-reject` keeps step 5 after the script. Recommendation: the script, so the phase and the index cannot disagree after a successful run; otherwise keep step 5 and say so in the plan.
4. **Unreachable origin.** Either an `ls-remote` that does not answer refuses with its own reason (for example `refs-unknown`) or it is treated as swept. Recommendation: its own refusal; a false "already deleted" sends the operator to restore a branch that exists.
5. **Old `(Branch: ` format.** Either keep reading it or drop it. Recommendation: keep it — 360 delivered plans use it (measured), and `plot-plan-meta.sh` already reads both, so reusing it costs nothing.

## (e) Position

amend. The two defects are real and the slicing (rule first, controller second) is right. As written, slice 1 makes `refs-swept` fire on every delivered plan of this estate, because merged branches are deleted on merge, and slice 2 then makes that refusal final for `/plot-reject` while leaving the commit refused by `plot-state-gate.sh` and the symlink unmoved. Narrow the swept reading to unmerged, non-deferred, answered refs; settle the receipt and the symlink owner; then approve.
