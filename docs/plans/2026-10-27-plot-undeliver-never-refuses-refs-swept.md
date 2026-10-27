# plot-undeliver reads only the old slice format, and its refusal fires on merged work

> `plot-undeliver.sh` finds branches only in the old `(Branch: …)` form, and on those plans it refuses `refs-swept` for branches that merged. `/plot-reject` reverses a delivery by hand instead of through the script.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2764
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2787 merged
- **Started:** 2026-10-27, Jan Wloka, `bug/plot-undeliver-reads-slices`
- **Started:** 2026-10-27, Jan Wloka, `bug/plot-reject-calls-plot-undeliver` (brief only, no claim yet)
- **Delivered:** 2026-10-27

## Changelog

- `plot-undeliver.sh` reads a plan's branches in both slice formats, and refuses `refs-swept` only for lost work: a branch with no remote ref, no merged PR, and a PR that closed unmerged. An unreachable origin refuses `refs-unknown` and does not claim deletion. The script records its own state receipt and moves the plan's index entry from `delivered/` to `active/`. `/plot-reject` moves a delivered plan back to Approved through `plot-undeliver.sh`.

Board impact: the board bundle `plot-undeliver.sh` runs (`entry/plan-undeliver.ts`) is rebuilt, because the domain `undeliver` transition changes its input. The plan format does not change.

## Motivation

`skills/plot/scripts/plot-undeliver.sh:79` collects branches with `grep -oE '\(Branch: [^,)]+'`. Two plan formats exist:

- The heading form `### Name (Branch: x)`: 358 of 594 plans in `docs/plans/` (panel round 1, layering juror). The regex reads it.
- The list form `` - `branch` — … `` under `## Slices`: 53 of 54 plans whose `State:` reads Delivered. The regex reads nothing, so `swept` is empty and the script decides `→ Approved`.

The refusal is wrong where it fires. `refs-swept` refuses when any named branch has no remote ref. This repository deletes a branch when its PR merges (`delete_branch_on_merge: true`), and `plot-release-refs.sh` deletes merged refs by design. Panel round 1 measured 54 of 55 Delivered plans with every non-deferred branch ref gone. So on a heading-form plan the script refuses a merged plan today, and a reader that only adds the list form would refuse nearly every rejection, including the "branches unbuilt" case `/plot-reject` exists for.

The motivating case was correct. On 2026-10-27 the #2760 panel ran `plot-undeliver.sh` on a scratch copy of the #2400 plan at `b2df79eaf`. The ref `bug/plot-host-bitbucket-pr-list-reads` was gone and the script decided `→ Approved`. That branch is PR #2422, merged 2026-10-26T14:19:47Z: the work is on main, and `→ Approved` was the right outcome.

Four more defects, measured in panel round 1:

- `git ls-remote --exit-code` returns 2 for a missing ref and 128 for an unreachable remote. Line 81 treats every non-zero exit as missing, so an unreachable origin reads as "already deleted".
- `plot-undeliver.sh` writes no state receipt. `plot-state-gate.sh` refuses the commit (exit 2) and names `/plot-approve` as the owner, because `owningCommand` (`packages/domain/src/rules/state-transition.ts:139`) ignores the from-state.
- The script does not move the `delivered/` index entry, so `/plot-reject` step 5 moves it by hand. Without it, `plot-sprint-release.sh` `plan_delivery` scores the rejected plan as delivered.
- Every refusal prints `plan ''`: `entry/plan-undeliver.ts` reads a `Slug:` field that no plan carries.

`skills/plot-reject/SKILL.md` steps 4–5 edit `State:` from Delivered to Approved by hand under `plot-state-receipt.sh --unowned`. No `SKILL.md` calls `plot-undeliver.sh`, so the rejection has no controller and none of its refusals can run.

Found by the panel on plan PR #2760 (`auto-deliver-re-delivers-a-rejected`); out of that plan's scope.

## Design

### Approach

1. **Branches.** `plot-undeliver.sh` reads branches through `plot-plan-meta.sh` `waves[].branches[]` and drops entries with `deferred: true`. This reads both formats and adds no second parser.
2. **Readings, not a verdict.** For each branch the shell supplies one reading line to the bundle: the branch name, the ref (`present`, `absent` or `unknown`), the host merge answer from `pr_merged` in `plot-pr-merged.sh` (`merged`, `not-merged` or `unknown`), and whether a closed unmerged PR exists from `plot-host.sh pr-list --state closed --branch <b>` (`yes`, `no` or `unknown`). `ls-remote` exit 0 is `present`, exit 2 is `absent`, and any other exit is `unknown`. The shell asks the host only for a branch whose ref is `absent`.
3. **The decision is the domain's.** `undeliver` in `packages/domain/src/transitions/plan.ts` takes the per-branch readings in place of the pre-decided `refs` precondition:
   - Any branch whose ref is `unknown`, or whose host answers are `unknown` while its ref is `absent`, refuses `refs-unknown`. The text says the origin or host did not answer and does not claim deletion.
   - A branch with ref `absent`, `not-merged`, and a closed unmerged PR refuses `refs-swept`.
   - Every other branch passes: merged and deleted, never pushed, and present.
4. **Slug.** The shell passes the slug in the bundle's header line, and the refusal text names the plan.
5. **Receipt and owner.** `plot-undeliver.sh` calls `record_state_receipt "$file" Approved` after its write, as `plot-sprint-state.sh:169` does. `owningCommand` takes the from-state, and Delivered → Approved names `/plot-reject`.
6. **Index entry.** `plot-undeliver.sh` moves `docs/plans/delivered/<slug>.md` to `docs/plans/active/<slug>.md` in the same write as the state flip.
7. **Controller path.** `/plot-reject` steps 4–5 call `plot-undeliver.sh <slug> --why <reason>` in place of the hand edit, the `--unowned` receipt and the symlink move. A refusal ends the rejection ([The Master Agent Uses The Controllers](../../CLAUDE.md)), and the skill states what the operator does on each refusal: `refs-swept` means write a new plan for the lost work, and `refs-unknown` means retry when origin and host answer. Step 3 asks merged state through `plot-pr-merged.sh` in place of `gh pr list`. Steps 4, 6 and 8 describe what the script writes: `Rejected:` above a kept `Delivered:` line, and `State: Approved`. The `plot-state-receipt.sh` header and the skill no longer name `/plot-reject` as an unowned writer. The Model Guidance table and `README.md` change with it.

### Cost

One rejection asks the host twice per non-deferred branch whose ref is absent: one `pr_merged` lookup and one closed-PR list. On this repository that is every branch of a delivered plan. The script runs once per operator command, which [A Shell Script Asks The Domain](../../docs/shell-and-domain.md) permits.

### Out of scope

- A Bitbucket adopter. `plot-host.sh` answers `pr-list --state closed` and `pr-merged` on both backends, but this plan tests against GitHub fixtures only. A Bitbucket run waits for the ewz-kus-portal checks.
- An `undeliver` controller endpoint and its board route. This plan uses the `plot-sprint-state.sh` tier: a script, a domain decision and a receipt. The endpoint is a named follow-up.

### Decisions

Decided by Jan Wloka on 2026-10-27 after [panel round 1](../../.plot/panels/2026-10-27-plot-undeliver-never-refuses-refs-swept/panel.md):

1. `refs-swept` refuses only lost work: a non-deferred branch with no remote ref, no host `mergedAt`, and a host PR that closed unmerged. The domain decides from per-branch readings that the shell supplies.
2. A host PR that closed unmerged proves that a branch existed.
3. `plot-undeliver.sh` records its own state receipt, and `owningCommand` learns the from-state so Delivered → Approved names `/plot-reject`. This lands in slice 1, before the skill slice removes the `--unowned` receipt.
4. `plot-undeliver.sh` moves the `delivered/` → `active/` index entry in the same write as the state flip. `/plot-reject` step 5 goes.
5. An unreachable origin refuses `refs-unknown`, which does not claim deletion.
6. Branches come from `plot-plan-meta.sh` `waves[].branches[]` with deferred branches excluded.
7. Controller tier: script, domain decision and receipt now. An `undeliver` controller endpoint is a follow-up outside this plan.
8. The problem is that the script reads only the old slice format and its refusal fires on merged work. The motivating `→ Approved` of the #2400 plan (PR #2422) was correct.

## Done when

Domain (`packages/domain`), each failing before slice 1:

- [ ] `transitions.test.ts` (the `refs-swept` case at about line 815) changes with the rule: a branch that is absent, not merged, and has a closed unmerged PR refuses `refs-swept`.
- [ ] A merged-and-deleted branch, a never-pushed branch (absent, not merged, no PR), and a present branch each decide `approved`.
- [ ] A branch with ref `unknown`, and an absent branch with a host answer `unknown`, refuse `refs-unknown`, and the text does not contain "deleted".
- [ ] `owningCommand` names `/plot-reject` for Delivered → Approved and still names `/plot-approve` for Draft or Design → Approved.

Script (`test/reconcile/`, throwaway repo with a local bare origin and a stub host), each failing before slice 1:

- [ ] A list-form Delivered plan whose only branch merged and was deleted decides `→ Approved`. The heading-form version of the same plan also decides `→ Approved`, where today it refuses.
- [ ] A list-form plan with one branch absent, not merged, and with a closed unmerged PR exits 1, and its output names `refs-swept` and the plan slug.
- [ ] A deferred branch with no ref does not affect the decision.
- [ ] An origin URL that does not answer exits 1 with `refs-unknown`.
- [ ] After a successful run, `plot-state-gate.sh` accepts the commit with no `--unowned` receipt, and `docs/plans/active/<slug>.md` exists while `docs/plans/delivered/<slug>.md` does not.
- [ ] The host stub records no call for a branch whose ref is present.

Skill and repo:

- [ ] `skills/plot-reject/SKILL.md` contains no `--unowned`, no `gh pr list`, and no hand edit of `State:` or of the index symlink.
- [ ] `scripts/check-shell-lines.sh pr` shows zero net growth. The new receipt, symlink and host-reading lines are paid for in the same change, first by the removed regex and verdict loop in `plot-undeliver.sh`.

## Slices

### Refusal

- `bug/plot-undeliver-reads-slices` — the domain decides `refs-swept` and `refs-unknown` from per-branch readings; `plot-undeliver.sh` reads branches through `plot-plan-meta.sh`, supplies readings and the slug, records its receipt and moves the index entry; `owningCommand` learns the from-state → #2795

### Controller

- `bug/plot-reject-calls-plot-undeliver` — `/plot-reject` moves the phase through `plot-undeliver.sh` and states what each refusal asks of the operator <!-- waits: bug/plot-undeliver-reads-slices --> → #2800

## Notes

Created from tracker issue #2764. The tracker is not written to; the `Issue:` field is the only link.

2026-10-27: amended after panel round 1 with Jan Wloka's decisions.
