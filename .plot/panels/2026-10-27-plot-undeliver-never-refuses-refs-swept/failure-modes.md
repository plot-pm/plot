# Failure modes and safety — plot-undeliver-never-refuses-refs-swept

Position: amend
Evidence: ran plot-undeliver.sh (as shipped, and a scratch copy with line 79 replaced by a `## Slices` backtick reader) in a throwaway repo with a local bare origin on 3 plans (current format, old `(Branch:` format, synthetic partial delivery) across ref-present, ref-deleted, never-pushed, unreachable-origin and no-origin cases; ran plot-plan-meta.sh on both formats; measured all 597 `docs/plans/delivered/` plans against `git ls-remote --heads origin` (10 heads); read plan.ts:730-822, plot-reject/SKILL.md, plot-state-receipt.sh, state-transition.ts:123-145/472-500, plan-undeliver.ts (grep), plot-release-refs.sh header.

## What I ran versus what I read

Ran: every case in the table below, in `scratchpad/juror-failure-modes/repo` with `origin` = a local bare repo. Ran the delivered-plan measurement over the subject worktree. Read only: the state gate's receipt logic and the domain transition source.

| Case | Shipped script | With the planned reader |
|---|---|---|
| Current-format plan, slice merged (#2276), ref deleted | `→ Approved` (rc 0) | `refs-swept` (rc 1) |
| Same, ref present on origin | `→ Approved` | `→ Approved` |
| Same, ref present, origin URL unreachable (ls-remote rc 128) | — | `refs-swept` (rc 1), "already deleted" |
| Same, no `origin` remote at all | — | `refs-swept` (rc 1) |
| Old `### … (Branch: x, PR: #1019)` plan, merged, ref deleted | `refs-swept` (rc 1) | — |
| Synthetic premature delivery: 1 merged+deleted, 1 never pushed, 1 deferred | `→ Approved` | `refs-swept` naming all three, including the never-pushed and the deferred slice |

## (a) Problem statement

The mechanism is right: line 79 reads only `(Branch: `, and a current-format plan sends an empty `swept` field. Two measured facts make the statement incomplete.

- **The title is false for 46 % of delivered plans.** 276 of 597 delivered plans carry the old `(Branch: …` form under `## Slices`, and on those the shipped script already refuses `refs-swept`. So the refusal fires today, on the older half of the estate, and the right problem is that it fires *wrongly* there, not that it never fires.
- **The rule it would switch on is the wrong rule.** Of the 320 delivered plans with current-format slices, 317 (99 %) have every slice ref gone and 3 have every ref present; none is partial. `plot-release-refs.sh` deletes the remote refs of *merged* branches by design, and GitHub deletes merged heads. A deleted ref of a merged branch is not "work that no longer exists anywhere" (plan.ts message): the work is on main. The panel case that motivated the plan (#2400, `bug/plot-host-bitbucket-pr-list-reads` gone) is exactly this shape, so "the script still decided → Approved" was arguably the correct outcome there.

## (b) Does the approach solve it without a new defect

No. Slice 1 as written introduces four defects.

1. **It refuses legitimate rejections, almost all of them.** With the reader fixed, 317 of 320 current-format delivered plans become unrejectable through the script. The canonical rejection — "5/7 branches unbuilt" in `/plot-reject`'s own example — is refused, because a never-pushed branch has no remote ref and reads as swept (case 6). The refusal message then tells the operator the work was "already deleted", which is false.
2. **It reports a transport failure as swept refs.** Line 81 treats every non-zero `git ls-remote --exit-code` as missing. Measured: rc 2 = no such ref, rc 128 = remote unreachable. Offline, with an expired credential, or in a repo with no `origin`, every slice is reported "already deleted". The existing test `test/reconcile/undeliver-two-format-scan.test.mjs` builds a repo with no remote; whether it breaks depends on whether its fixture names slices — the slice must check that it does not.
3. **Deferred slices count as swept.** `plot-plan-meta.sh` lists deferred branches in `branches` (verified: `feature/partial-later` with `deferred:true`). A plan whose only missing ref is a deferred slice would be refused.
4. **The repair path is closed too.** The domain checks `refs` for `phase === 'approved'` as well, so a half-written rejection (State already Approved, symlink still in `delivered/`) cannot be completed through the script either.

Slice 2 then compounds slice 1: it removes the `--unowned` hand edit, which is the only remaining route, so after both slices `/plot-reject` stops for nearly every plan with no exit.

## (c) Slices: missing, wrong, out of order

- **Missing slice 0: define "swept" in the domain before wiring the reader.** The precondition should be: a slice that is *not merged* (host `mergedAt`, per *One Answer To "Did This Land"*) and *not deferred*, whose remote ref is gone *and* is known to have existed (had commits or a PR). Merged slices, never-pushed slices and deferred slices are not swept. That needs a per-slice reading the shell already can buy (`plot-pr-merged.sh`), or the decision moves to the domain with readings as values. The `transitions.test.ts:815` case keeps its name; new cases pin each of the three exclusions.
- **Slice 1 must distinguish rc 2 from other exit codes** and refuse with a different name (or `precondition-unmet` with "could not read origin") on rc ≠ 0,2. A refusal that blames the plan for a network error sends the operator to restore refs that exist.
- **Slice 1's test list is one-sided.** It tests "ref gone → refuses" and "all refs exist → Approved". It needs: merged+deleted → Approved; never pushed → Approved; deferred missing → Approved; origin unreachable → not `refs-swept`; old `(Branch:` form merged+deleted → Approved (this fixes the 276 plans refused today).
- **Slice 2 is missing the receipt.** `plot-undeliver.sh` and `plan-undeliver.ts` write no state receipt (grep: zero hits for `receipt`). `plot-state-gate.sh` refuses a Delivered → Approved commit without one, and its refusal names `/plot-approve` as the owner of `approved` (state-transition.ts:139-140), which itself refuses a Delivered plan. So replacing the `--unowned` receipt with the script makes the rejection commit unpassable. `plot-undeliver.sh` must call `record_state_receipt` after its `mv`, and `owningCommand` must name `/plot-reject` for a delivered → approved transition. This belongs in slice 2 or a slice before it.
- **Slice 2 is ambiguous about step 5.** The plan says the script replaces "steps 4–5". Step 5 moves the `delivered/` symlink to `active/`; the script does not touch symlinks (line 63 excludes those dirs and nothing writes them). If step 5 is dropped, the plan is left `State: Approved` with its index entry in `delivered/` — between states. The plan must say step 5 stays (or the script takes it over).
- **Record format changes silently.** The skill writes `Rejected: YYYY-MM-DD (<reason>)` and replaces the `Delivered:` line; the script writes `Rejected: YYYY-MM-DD, <reason>` and keeps `Delivered:`. auto-deliver.ts reads the record by name, so this is probably safe, but the slice should say which format wins and check `plot-sprint-release.sh`'s reader.
- **Small: the refusal prints `plan ''`.** Every refusal I triggered printed an empty slug (`plot-undeliver: plan '' has branches …`), so `plan-undeliver.ts` does not pass the slug to the domain. Worth fixing in slice 1 because slice 2 makes that message the operator's only output.
- **Small: `slices[].branch` does not exist.** `plot-plan-meta.sh` emits `branches` and `waves[].branches[].branch` (with `deferred`). The plan should name the real field; the `waves[]` one is the one that carries `deferred`.

## (d) Questions a person must decide before approval

1. **What does `refs-swept` protect?** Either (A) any slice ref gone refuses, as the domain says today, or (B) only an unmerged, non-deferred slice whose ref existed and is gone refuses. Recommend **B**: A refuses 99 % of real rejections and the never-pushed case that rejection exists for; B keeps the one case where work is actually lost.
2. **Old `(Branch:` form:** either keep reading it or drop it. Recommend **keep**, through `plot-plan-meta.sh`, which already reads both (verified) — 276 delivered plans use it, and with B they stop being wrongly refused.
3. **Unreachable origin:** either refuse with a distinct name, or treat as unknown and proceed. Recommend **refuse with a distinct name** (not `refs-swept`): a reversal decided without the reading should not be silent, and the message must not claim deletion.
4. **Receipt:** either `plot-undeliver.sh` records its own receipt, or `/plot-reject` keeps `--unowned`. Recommend **the script records it**, in the same slice that removes `--unowned` — otherwise the gate blocks every rejection commit.
5. **Symlink move:** either the skill keeps step 5, or the script moves the index entry. Recommend **the skill keeps step 5** for this plan; moving it into the script is a separate change.

## (e) Position

Amend. The diagnosis of line 79 is correct and the controller routing in slice 2 is the right direction, but the plan wires a reader into a refusal whose meaning is wrong for merged and never-pushed slices, so as written it converts a mostly-silent refusal into one that blocks almost every legitimate `/plot-reject`, misreports network failures as deleted work, and then removes the only escape while leaving the commit unpassable at the state gate. Redefine `swept` in the domain first (question 1), add the receipt and keep the symlink step in slice 2, and the plan is safe to approve.
