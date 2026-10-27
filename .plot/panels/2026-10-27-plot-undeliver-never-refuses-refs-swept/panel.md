# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-plot-undeliver-never-refuses-refs-swept.md` at `e428bb900` (plan PR #2787, issue #2764, State Draft). Jurors: layering, lifecycle, failure-modes, testability. Gate: all four committed on `Position` (`proceed,amend,reject`) and `Evidence` (`ran,read`), exit 0 each. Reconcile: `unanimous amend`.

## Evidence basis

Every juror ran code; none answered from reading alone.

| Juror | Ran | Read only |
|---|---|---|
| layering | `plot-undeliver.sh` shipped and patched (reader via `plot-plan-meta.sh`) on a list-form Delivered plan with one merged-and-deleted and one never-built branch, in a throwaway repo with a bare origin; `plot-state-gate.sh` on the write with and without an `--unowned` receipt; format count over 594 plans | `transitions/plan.ts` undeliver, `entry/plan-undeliver.ts`, `rules/state-transition.ts` `owningCommand`, `rules/controller-gate.ts`, `plot-state-receipt.sh`, `plot-reject/SKILL.md` |
| lifecycle | `plot-undeliver.sh` on Delivered copies of one old-format and one `## Slices` plan (ref absent, ref present, origin unreachable); `plot-state-gate.sh` after a successful run; `plot-plan-meta.sh`; `git ls-remote --heads origin`; `gh pr list` for the motivating branch; `gh api … delete_branch_on_merge` | `auto-deliver.ts` `holdFromRejection`, `plot-sprint-release.sh` `plan_delivery`, `owningCommand`, the skill |
| failure-modes | the shipped and patched script across six cases (ref present, merged and deleted, never pushed, deferred, origin unreachable, no origin remote); `plot-plan-meta.sh` on both formats; all 597 `docs/plans/delivered/` entries against `git ls-remote` | the gate's receipt logic, `plan.ts:730-822`, `plot-release-refs.sh` header |
| testability | the shipped and patched script; `plot-state-gate.sh` on its write; 55 Delivered plans' branches against the real origin (10 heads) | `check-shell-lines.sh`, `MANIFESTO.md`, the skill, `plan-undeliver.ts` |

The moderator checked one shared assumption: `test/reconcile/undeliver-two-format-scan.test.mjs` exists, but "two-format" there means the `status:` and `phase:` front-matter keys (#2439), not the two slice formats. No existing test covers the slice reader.

## Findings all four share

1. **Slice 1 as written makes `/plot-reject` refuse almost every delivered plan.** "No remote ref" holds three different populations: merged and deleted (the work is on main), never pushed (unbuilt work, which is the reason `/plot-reject` exists), and pushed but unmerged and then deleted (the only case where work is lost). This repo has `delete_branch_on_merge: true`, and `plot-release-refs.sh` deletes merged refs by design. Testability measured 54 of 55 Delivered plans with every non-deferred branch ref gone. Failure-modes measured 317 of 320 current-format delivered index entries. All four reproduced the refusal on a never-pushed branch with the patched reader.
2. **The motivating case is a correct `→ Approved`.** Lifecycle confirmed that `bug/plot-host-bitbucket-pr-list-reads` is PR #2422, merged 2026-10-26T14:19:47Z. The ref is gone because the work landed. The domain's refusal text, "work that no longer exists anywhere", is false for a merged branch.
3. **The title overstates the bug.** Line 79's regex reads the `### Name (Branch: x)` heading form. On those plans the shipped script already refuses `refs-swept`, and it refuses wrongly, because those branches merged. The defect is "reads only the old format", not "never refuses".
4. **Slice 2 cannot commit.** `plot-undeliver.sh` writes no state receipt. All four ran `plot-state-gate.sh` on its write and got exit 2. The refusal names `/plot-approve` as the owner, because `owningCommand` (`rules/state-transition.ts:139`) ignores the from-state, and `/plot-approve` refuses a Delivered plan. This answers the plan's open question 1 by measurement: the script leaves no receipt.
5. **The refusal prints `plan ''`.** `plan-undeliver.ts` reads a `Slug:` field that no plan carries.
6. **`slices[].branch` does not exist.** `plot-plan-meta.sh` emits `branches` (deferred branches included) and `waves[].branches[]` (with a `deferred` flag). It reads both formats, which closes open question 2 without a second parser.

## Findings two or three jurors share

7. **Deferred slices read as swept** (lifecycle, failure-modes, testability). The flat `branches` list includes branches that were never created.
8. **An unreachable or absent origin reads as swept** (lifecycle, failure-modes, testability). `git ls-remote --exit-code` returns 2 for a missing ref and 128 for an unreachable remote, and line 81 treats every non-zero exit as missing. The operator is then told an existing branch was "already deleted".
9. **Slice 2 says "steps 4–5", but the script performs only step 4** (lifecycle, failure-modes). Step 5 moves the `delivered/` symlink to `active/`. If step 5 goes, the plan reads Approved while its index entry stays in `delivered/`, and `plot-sprint-release.sh` `plan_delivery` scores the rejected plan as delivered (lifecycle).
10. **The test list in approach step 2 is one-sided** (layering, lifecycle, failure-modes, testability). It names "ref gone → refuse" and "refs present → Approved". The cases that decide the design are missing: merged and deleted, never pushed, deferred, origin unreachable, and a heading-form regression.

## Single-juror findings worth keeping

- **Layering:** the shell decides "swept" (`plot-undeliver.sh:79-84`) and sends the domain a finished list. Per *The Layering Rule*, the shell should send per-branch readings (ref present, `mergedAt` from `plot-pr-merged.sh`), and `undeliver` should decide. Skill step 3 calls `gh pr list` directly instead of the host adapter. The `plot-state-receipt.sh` header and SKILL.md step 4 name `/plot-reject` as an unowned writer pending `a-rejection-is-a-controller-command`, and the plan updates neither text nor states its relation to that plan.
- **Lifecycle:** the skill replaces `Delivered:` with `Rejected:`, and the script keeps `Delivered:` and inserts `Rejected:` above it. `holdFromRejection` reads by name, so the #2775 hold still fires, but the skill text must describe what the script writes. Skill step 6 says `State: Rejected`, and the script writes `Approved`.
- **Failure-modes:** the domain also checks refs for `phase === 'approved'`, so a half-written rejection (Approved, symlink still in `delivered/`) cannot be completed through the script.
- **Testability:** "exits 1 with `refs-swept`" cannot match today's output, because line 98 cuts the rule name. The receipt adds 2 counted shell commands, and `check-shell-lines.sh` stores no allowance, so the plan must name where 2 lines come out. Manifesto Q3 (fail gracefully) fails as written.

## Disagreements

- **Where the symlink move lives.** Lifecycle wants `plot-undeliver.sh` to move the index entry in the same write, so the phase and the index cannot disagree. Failure-modes wants the skill to keep step 5 and leave the script unchanged, calling the move a separate change. Each choice gives a different slice 2.
- **The exact definition of "swept".** All four reject "any ref gone", but they draw the boundary differently. Layering: no ref, no `mergedAt`, and the branch had a PR or carried commits. Failure-modes: unmerged, not deferred, and the ref is known to have existed. Testability: no ref, no merged PR, and a PR that was opened and closed unmerged. Testability also offers option C: stop measuring refs in this script at all. The three B variants differ on whether "carried commits" without a PR counts. Only a host PR record is cheap to read, so the choice decides what the shell must buy.
- **An unreachable origin.** Lifecycle and failure-modes want a distinct refusal name. Testability frames it as "which remote", hardcoded `origin` or the configured remote. These are compatible, but neither framing covers the other.
- **Controller tier.** Only layering raises it: the script-plus-receipt tier now, with a named follow-up for a `ControllerAction 'undeliver'` endpoint. The other three accept the script as the controller without saying so.
- **Counts.** The jurors give 54, 55, 320 and 597 for "delivered plans". The bases differ: plans whose `State:` reads Delivered, against `docs/plans/delivered/` index entries, which include Released plans. The direction agrees, but the plan should cite one base.

## What the lenses shared and might all have missed

All four measured this repository. It deletes merged branches on merge. None asked how the narrowed rule behaves on a Bitbucket adopter, where `plot-pr-merged.sh` takes a different path and branch deletion is a per-PR choice. Reading `mergedAt` per slice is one host call per branch, once per operator command. *A Shell Script Asks The Domain* permits that cost, but no juror counted it for a plan with many slices. No juror ran the domain unit tests (`transitions.test.ts` around line 815 pins today's `refs-swept`), so nobody confirmed which existing assertions the redefinition breaks. And all four accepted that the refusal should stay in `undeliver`. Only testability's option C asks whether a delivery reversal needs a ref check at all once `mergedAt` answers "did this land".

## Decisions for the operator

1. **What does `refs-swept` refuse?** (A) Any non-deferred slice branch with no remote ref, which is the domain's current wording and refuses about 54 of 55 Delivered plans here. (B) Only a branch with no remote ref and no host `mergedAt` that was known to exist, which keeps the one case where work is lost. (C) This script stops measuring refs, and the refusal stays unreached. **Panel recommendation: B, decided in the domain from per-branch readings that the shell supplies.** Four of four reject A. Testability names C as the fallback if B costs too much for this plan.
2. **Under B, what proves that a branch existed?** (i) A PR on the host that closed unmerged. (ii) Any evidence of commits, PR or not. **Recommendation: (i).** A PR record is a host answer the shell can read through `plot-host.sh`. "Carried commits" on a deleted ref has no cheap reading.
3. **Who writes the state receipt?** (A) `plot-undeliver.sh` records its own receipt, and `owningCommand` learns the from-state so Delivered → Approved names `/plot-reject`. (B) `/plot-reject` keeps `plot-state-receipt.sh --unowned`. **Recommendation: A, landing in slice 1 or before slice 2, never after.** Without it, the gate refuses every rejection commit and names `/plot-approve`.
4. **Who moves the `delivered/` → `active/` symlink?** (A) `plot-undeliver.sh`, in the same write. (B) `/plot-reject` keeps step 5 after a successful script run. **The panel is split:** lifecycle recommends A, failure-modes recommends B. The moderator notes that B is the smaller change and A closes the half-written state that failure-modes found the script cannot repair.
5. **How does an unreachable origin read?** (A) As swept, which is today's behaviour. (B) As a distinct refusal (for example `refs-unknown`) that does not claim deletion. **Recommendation: B.**
6. **Which parse reads the branches?** (A) A second regex for the list form beside the old one. (B) `plot-plan-meta.sh` `waves[].branches[]` with deferred branches excluded. **Recommendation: B.** It reads both formats and carries the deferred flag, and it closes the plan's open question 2.
7. **What is the controller tier for this plan?** (A) Script plus domain decision plus receipt now (the `plot-sprint-state.sh` tier), with an `undeliver` endpoint as a named follow-up. (B) A full controller action and endpoint in this plan. **Recommendation: A** (layering only; the other jurors did not address it).
8. **Does the plan restate its problem?** (A) Keep the title and Motivation. (B) Restate the problem as "reads only the old slice format, and its refusal fires on merged work". **Recommendation: B.** Four of four found that the title overstates the bug and that the motivating `→ Approved` was correct.
