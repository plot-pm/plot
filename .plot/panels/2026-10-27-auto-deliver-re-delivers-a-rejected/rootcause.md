# Juror: rootcause

Position: amend

Lens: reproduce the re-delivery, confirm or refute the named cause, find other deliver paths with the same cause. Code cited from `pmain` at `4a1b8a5fa`.

## 1. The problem

**The re-delivery reproduces, and the first named cause holds.**

- **Ran** `git log` and `git show` on `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md`. The Status block moves Approved → Delivered (`b2df79eaf`, 15:21:07 +0100), then Delivered → Approved with `Rejected: 2026-10-26 (…)` replacing `Delivered:` (`6666041ff`, 15:38:04), then Approved → Delivered with a second `Delivered: 2026-10-26` under the `Rejected:` line (`c67b5cd1f`, 15:38:47). `origin/main` still holds that last state.
- **Read** `.worktrees/plot-deliver-plot-host-bitbucket-pr-list-reads.log` (mtime Oct 26 15:39). It holds two `plot-deliver` runs, and each is followed by a `plot-reap.sh` sweep and a `plot-release-refs.sh` run. That deliver → reap → release chain is `runAutoDeliver` (`packages/fleet/src/shared/auto-deliver.ts:155-302`) on its script arm. Both deliveries came from fleetd's `runAutoDeliverPass` (`auto-writes.ts:55`), not from a person. `maybeAutoDeliver` (`auto-deliver.ts:395`) has no caller (**ran** grep).
- **Ran** `planAutoDeliver` from `pmain` source, bundled with esbuild, against this plan's row from `.plot/state/last-pulse.json` with `phase` set to `approved`. It returns `[{slug: "plot-host-bitbucket-pr-list-reads"}]` when the branch carries host evidence, and `[]` when the branch carries `evidence: "subject"` or the phase is `delivered`. So any pulse after `6666041ff` that reads the branch merged from the host delivers the plan again.
- **Read** why: `planAutoDeliver` takes only the pulse (`packages/domain/src/rules/auto-deliver.ts:285-296`), and a pulse plan carries only `file`, `phase`, `tracer` and `slices` (`packages/domain/src/entities/fleet.ts:695-722`). No input separates an Approved plan that was never delivered from one a person just rejected. `isDeliverable` (`auto-deliver.ts:340-395`) checks phase, in-flight, `allSlicesConfirmed`, `landedBranches > 0` and `retryVerdict`. A rejection changes none of them: `deliveryReading` (`:144`) is branch states only, so the failure record does not reset or hold either.

**The second named cause is real, but the plan misdescribes it.**

- **Ran** `gh pr view 2422`: two commits (`d92e323f9 plot: claim …`, `f576060de … blocked on bb pr list --all`), **zero files**. No `.plot/claims/` directory exists in this repository (**ran** `git ls-files .plot`). A claim is an empty commit (`packages/domain/src/rules/empty-claim.ts:1-36`, `isEmptyClaim`: subject prefix plus tree equal to parent tree). The plan's definition "a diff that holds nothing beyond `.plot/claims/`" therefore matches no real claim PR shape.
- **Read** that the system already measures this. `carriedWorkOf` (`packages/board/src/server/controllers/deliverability.ts:211-227`) reads the merge commit's files and ignores `PLOT-BLOCKED*`. `emptySlices` (`packages/domain/src/workflows/deliver.ts:113-114`) names the branch. The deliver log shows it fired on both runs: *"this plan's merged PR carried no implementation on: bug/plot-host-bitbucket-pr-list-reads … check whether its work landed under another PR, mark it deferred, or re-open it. Delivery continues."* (`packages/board/src/server/entry/deliver.ts:427-431`).
- **Read** that "does not refuse" is a recorded decision: `deliver.ts:96-104` cites a 2026-09-08 measurement where 3 of 7 claim-only PRs belonged to slices that finished under a different PR. The plan does not cite or narrow that decision.
- **Not found**: the "merge watcher" wording "changes no file beyond its claim". **Ran** grep over `packages/*/src` and `skills/plot/scripts/*.sh`; no source carries it. The definition to reuse is `carriedWork` / `emptySlices`, not a merge-watcher rule.

**The plan misses an upstream cause: the rejection itself.**

- **Read** `skills/plot-reject/SKILL.md:96-112`. `/plot-reject` is a hand edit with an unowned receipt ("has no controller"). Its step 3 (`:93`) already warns when every non-deferred branch merged, which is this case, and it proceeded. A rejection that leaves every non-deferred branch merged produces a plan every deliver rule reads as finished, so auto-deliver is only the first reader to act on it.
- **Read** that a controller exists and is not used: `skills/plot/scripts/plot-undeliver.sh` over the domain `undeliver` transition (`packages/domain/src/transitions/plan.ts:749-822`), which refuses `refs-swept`. No `SKILL.md` calls it (**ran** grep).
- **Ran** `plot-undeliver.sh` on a copy of the plan at `b2df79eaf` in a scratch `--dir`. `git ls-remote --exit-code --heads origin bug/plot-host-bitbucket-pr-list-reads` exits 2 (ref gone), yet the script decided `→ Approved`. Its branch parser greps `(Branch: …` (`plot-undeliver.sh:79`), which current `## Slices` lines (`` - `branch` — … ``) do not contain, so `swept` is always empty and `refs-swept` never fires.
- **Read** a minor factual slip: the plan says the first delivery was "14:19 UTC". 14:19:47Z is PR #2422's `mergedAt`; `b2df79eaf` is 14:21:07 UTC.

**Other deliver paths with the same cause.**

- `skills/ralph-plot-sprint/SKILL.md:142` and `:239` run `/plot-deliver <slug>` unattended once every non-deferred branch has a merged PR. It reads no `Rejected:` record and counts a claim-only PR. A fix in `planAutoDeliver` alone does not reach it.
- The `Deliver command` agent arm of auto-deliver (`auto-deliver.ts:254-290`) is covered only if the hold sits before `runAutoDeliver`, as the plan proposes.
- The board's `deliverable` reading and the sprint tick read the same pulse and show the rejected plan as deliverable. That is a person's decision path and is acceptable, but the card gives no sign of the rejection.

## 2. The approach against the code

- **Approach 1 needs an input the plan says it does not add.** The plan states "adds no plan field" and "Board impact: none expected". The pulse carries no Status record, so the hold needs either (a) a new pulse field emitted by `plot-fleet-scan.sh`, following the `tracer` precedent (`plot-fleet-scan.sh:3117`, `:5016`), with a `PlanSchema` default and shell-line cost under `check-shell-lines.sh`, or (b) the fleet reading the plan file for candidate plans only and passing the record into `planAutoDeliver` as a value (the "readings as values" shape in CLAUDE.md). (b) costs no shell lines and changes no pulse schema. The plan must choose one and state the cost.
- **"Until a branch merges after that date" has no reading to compare.** The `Rejected:` record holds a date and no time. The pulse holds no `mergedAt`, and `changed_at` is `null` for this merged branch (**read** last-pulse row). The simpler rule is the precedent at `auto-deliver.ts:370-389`: an unattended path does not resolve a question a person was asked. So a plan whose latest Status record is `Rejected:` is never auto-delivered, and a person delivers it. This removes open question 1.
- **Approach 2 sits in the wrong place as written.** `planAutoDeliver` cannot see `carriedWork`; that needs `host.prMergeCommit` plus `refs.commitFiles` per branch. Asking that every pass for a held plan spends host calls forever. Two placements work: refuse in the deliver entry when the run is unattended (the agent arm already sets `PLOT_UNATTENDED=1`, `auto-deliver.ts:270`; the script arm would need a flag), with a refusal that `runAutoDeliverPass` records as `stopped` at once under the current `deliveryReading`, so a later merge changes the reading and lifts it (`retryVerdict`, `:104-112`); or compute `carriedWork` once per reading in the fleet and cache it by reading. Either way the domain rule is "unattended + `emptySlices` non-empty → hold", and the person path keeps "Delivery continues".
- **Approach 3 (corpus pair) has no subject.** `carriedWork` has one implementation in TypeScript; no shell twin exists (**ran** grep). Drop it or name the pair.

## 3. Safety

- Both holds only withhold an unattended delivery, and the chain after delivery is reap plus `plot-release-refs.sh --yes`. Withholding cannot delete a ref or a worktree. No merge or release path changes.
- Risk if open question 3 is answered "one shared rule": a claim-only refusal in `/plot-deliver` for people would block the 2026-09-08 cases where the slice finished under another PR (`deliver.ts:96-104`). The hold must be unattended-only.
- Risk in the deliver-entry placement: a plain refusal enters the failure counter (`recordDeliveryFailure`), retries at 60 s and 120 s, and reports "failed 3 consecutive deliveries" (`auto-deliver.ts:458-472`, `reportStopped`), which misnames a deliberate hold as a failure. The refusal needs its own outcome.

## 4. Slices against Changelog and acceptance

- Slice 1's test ("reject a delivered plan with all slices merged, run the pass, assert no delivery") fails on today's code: my run returns the plan. It must state the input shape (pulse field or record value), since today's `PlanAutoDeliverInput` has no place for it.
- Slice 2 names no test. A checkable one: a pulse plan whose only merged branch reads `carriedWork: false`, unattended, produces no delivery; the same with a person produces the "Delivery continues" note. Today's deliver entry delivers in both cases (log above).
- The order is fine; the two slices are independent.
- The Changelog line promises "no longer re-delivers a plan after `/plot-reject`". That is true only for the fleet path while ralph and a typed unattended `/plot-deliver` keep the defect. Narrow the line or widen the scope.

## 5. New defects

- `plot-undeliver.sh:79` parses a branch syntax current plans do not use, so the `refs-swept` refusal is dead (**ran**). Out of this plan's scope, but it is the same incident's root and should be filed.
- Option (a) for approach 1 costs shell lines under the ratchet and a pulse schema field (board contract, `PlanSchema` default for older pulses). Option (b) costs neither.
- Bitbucket: `carriedWorkOf` asks `host.prMergeCommit`, which both backends implement; a squash merge on Bitbucket reports a merge commit too. No new host call is GitHub-only if the existing reading is reused.
- Project-agnostic: the plan names `.plot/claims/`, a path no adopting repository writes. Use the existing claim definition.

## Amendments

1. Replace the claim-only definition. A slice is claim-only when `carriedWork === false` (`deliverability.ts:211`, `emptySlices` in `workflows/deliver.ts:113`), not when its diff "holds nothing beyond `.plot/claims/`". Drop the "merge watcher" reference, or cite the file that holds it.
2. Cite and narrow the 2026-09-08 decision (`workflows/deliver.ts:96-104`): the claim-only hold applies to the unattended path only, and `/plot-deliver` by a person keeps "Delivery continues". This answers open question 3 for this check.
3. Make the rejection hold "a plan whose latest Status record is `Rejected:` is not auto-delivered; a person delivers it", on the precedent at `auto-deliver.ts:370-389`. Drop "until a branch merges after that date" and open question 1.
4. Name how `planAutoDeliver` receives the `Rejected:` record: a pulse field from the scan (state the shell-line and schema cost, and correct "Board impact: none") or a value read by the fleet for candidate plans only.
5. Name where `carriedWork` is measured for the unattended path and how a hold avoids the failure counter's retry-and-"failed" report, keyed to `deliveryReading` so a new merge lifts it.
6. Add `skills/ralph-plot-sprint/SKILL.md:142,239` to scope, or narrow the Changelog to the fleet's auto-deliver.
7. Record the upstream cause in Motivation: `/plot-reject` hand-edits a fully merged plan back to Approved and does not call `plot-undeliver.sh`, whose `refs-swept` check parses `(Branch: …` and never fires on current plans. File it as its own issue if it stays out of scope.
8. Drop approach 3 (no shell twin of `carriedWork` exists) and give slice 2 a test that fails on today's code.
9. Correct "first delivery 14:19 UTC" to 14:21 UTC; 14:19:47Z is PR #2422's merge.
