# r2 juror: contradiction

Lens: does the amended plan disagree with a sibling plan, the design spec, a CLAUDE.md decision or a controller's refusal? I read the plan, the round-1 moderation, the spec, the seven siblings, `delivery-placement.ts`, `delivery-readings.ts`, `ownership.ts`, `mine-filter.ts`, `delivery-row-form.ts`, `delivery-view.ts`, `AgentList.tsx:1160-1175`, `loose-delete.ts`, `dispatch-verbs.ts` (`releaseClaim`) and `release-claim-reader.ts`. I ran nothing. The round-1 amendments I checked hold: the slice order has no cycle (tickets-section → you-groups → slice-states/todo-list/work-items-gates → release-card), the `YouReason` table agrees with plan 1's release hand-off (plan 1 line 49), and the cited lines `delivery-placement.ts:125-137, 210-217, 337`, `delivery-row-form.ts:13, 381-395`, `delivery-view.ts:32-56, 248` and `schema.ts:2294-2310` exist and say what the plan says.

## 1. The amended "You ignores Mine" predicate contradicts the spec, CLAUDE.md and two siblings

Plan line 63: "You places an item only when its `ownership === 'mine'`, in every Mine mode". Open Points marks this resolved. The predicate removes rows that the spec, CLAUDE.md and the plan itself put under You:

- **Loose branches leave You.** A branch with no PR and no plan reads `ownedFromRow` → `{ kind: 'other' }` (`mine-filter.ts:141-146`) → `ownership` answers `'unknown'` (`ownership.ts:288`). Under the new predicate no loose branch is ever `mine`. That contradicts the spec ("Unblock: loose ends … A loose branch", spec:94; "A closed PR or branch no plan names moves to You › Unblock, not Queued", spec:116), CLAUDE.md ("The Delivery tab places a loose item under You › Unblock with the reason `loose`"), plan 3 (`delivery-work-items-show-gates.md:49`) and this plan's own `loose` row in the table.
- **Another person's closed PR leaves You.** `prOwnership` answers `theirs` for any other author (`ownership.ts:103-109`). The item then reaches `workGroup` with `stage: 'queued'` (`delivery-readings.ts:183`) and lands in Queued, which spec:116 and plan 3:49 forbid.
- **The release leaves You before plan 1 removes it.** The release row's PR is authored by the changesets bot, so it reads `theirs`, falls to `workGroup`, and `approvalOwed !== undefined` sends it to Queued (`delivery-placement.ts:224`). The plan's table says Blocks delivery "until plan 1's `feature/delivery-release-card` removes the row". Plan 1 line 49 relies on that row.
- **A teammate's PR that waits for review, and a teammate's fleet-stuck PR, leave You.** The spec's rule is "what waits on the person reading the board" (spec:182), not "what the reader authored". Today, with Mine off, they show (`mineAllows` `mode === 'off'`).
- **Plan 1's slice states become reader-dependent.** Plan 1 defines **Blocked** as "the slice sits under You › Blocks delivery" (`delivery-tab-header-and-my-sprint.md:45`) and counts it per release across "every team member's sprints together" (:43). If You holds only the reader's items, the release bar's blocked segment changes with who opens the board, and another person's dead-agent slice counts as queued or at a gate. Plan 5's slice strip reads the same classification (`delivery-release-progress-per-plan.md:44, 52`).

## 2. The closed-PR condition is narrower than `loose-delete`'s refusals

Plan line 64 keeps "a closed PR whose branch still exists and no plan names (`LooseReading.named` false)" and gives it **Delete**. `loose-delete` also refuses `held`: a desk on this machine, a manifest or a running worker (CLAUDE.md loose-delete paragraph; `LooseReading.held`, `delivery-placement.ts:86-87`). A closed PR's desk often survives it. The row would then show a Delete that the controller refuses. The CLAUDE.md definition of loose requires `held` false too, and `looseOf` already checks it (`delivery-placement.ts:186`). Today `looseOf` in the readings returns `undefined` for every closed PR, because `fixerInFlight` is unset (`delivery-readings.ts:156-157`). The plan does not say which facts a closed PR must carry. A builder must guess whether to reuse `looseOf` with `held`, or to place on `named` alone as written. **Release** does not contradict anything: `releaseClaim` refuses only an open or merged PR (`dispatch-verbs.ts`, the `pr-open` arm). The `AgentList.tsx:1165` comment "release refuses any branch with a PR" is stale, and the plan should not take it as the rule.

## 3. Smaller disagreements

- Plan line 64: "`delivery-readings.ts:128` drops a closed PR before placement." Line 128 is `hasOpenPr`. A closed PR is not dropped. It becomes an item with no `stage: 'pr'` and places in Queued (`delivery-readings.ts:177-184`), which is the behaviour spec:116 names.
- The header string (plan line 65) adds "<n> to clean up", which the spec header (spec:90) does not have. Plan 1's section header hides empty groups (`delivery-tab-header-and-my-sprint.md:109`), and spec:46 says a 0 count marks a group as empty. The plan keeps this as an open question, so nothing is wrong yet. The header still needs to come from plan 1's section summary and not from a string of its own.

## Rubric

1. Unsupported claims: the `ownership === 'mine'` reading of spec:182 (§1); "drops a closed PR" (§3).
2. Not provided by any slice: the loose facts a closed PR needs for placement (`held`, `fixing`) (§2). A reader-independent definition of Blocked for plan 1's slice states (§1).
3. A builder has to guess: whether loose branches and the release are exempt from the Mine predicate; whether a held closed PR shows Delete.
4. Most serious: §1. The resolved Mine point contradicts spec:94/116, the CLAUDE.md loose paragraph, plan 3:49, plan 1:45/49 and this plan's own table. It is fixable by editing the plan. One option: "You ignores the Mine filter: `youCase` places regardless of `input.mine`". That drops the gate at `:337` and does not add an ownership test. Draft plans, approvals and tickets keep their own ownership tests where the spec wants them. This needs a decision from Jan Wloka, but it does not stop the plan from being built.

Position: amend
