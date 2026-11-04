# Safety juror — record-names-no-branch-so-a (plan PR #3116, issue #3101)

Position: amend

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal rather than a guess. Evidence read at origin/main `e54e53815`.

## Findings

1. The defect is real and live now, not after a future PR. Plan PR #3095 is MERGED (`gh pr view 3095`), so the plan's sentence "Plan PR #3095 makes the queue read the same two fields, after which fleetd hands …" describes current behaviour. The registry queue can hand a moved or renamed spike branch to an unattended agent today. The Motivation must say so in the present tense, because the exposure sets the priority.

2. The plan names two readers; origin/main has at least seven sites that derive "the licensed branch" as `spikeOf(slices)` gated only on a non-empty `Spike approved:` record. Each one moves with the marker:
   - `packages/domain/src/workflows/plan-walk-assembly.ts:334` → `rules/eligible.ts:132-133` (scan verdict and queue).
   - `packages/board/src/server/entry/gate.ts:561-579` `approvedSpikeOf` → `rules/phase-gate.ts:192` lets an implementation COMMIT through on a Design plan for the derived branch. A moved marker admits commits on another branch.
   - `packages/board/src/server/entry/plangate.ts:51-62` `spikeBranchOf` — the dispatch plan gate. A moved marker admits a FAN-OUT.
   - `packages/board/src/server/board.ts:1393-1403` `approvedSpikeOf` (board rows, `approvedSpikes`).
   - `packages/board/src/server/fleet.ts:4106`, `packages/domain/src/rules/draft-placement.ts:13,37`, `packages/board/src/server/entry/verdicts.ts:96-113` (scan verdict columns).
   Option 2 (a commit gate) leaves all seven reading the wrong branch for any edit the gate does not see. Option 1 only closes the hole if every one of these sites reads the branch from the record. If the slice changes only `sliceVerdict`, the commit gate and the dispatch gate keep admitting the moved branch — half-done in the dangerous direction.

3. Option 2 cannot be the whole fix under this lens. `plot-state-gate.sh` sees only commits made on a checkout with the hook installed. An edit on the host web UI, on another machine, or by a merge of a plan PR from elsewhere reaches `origin/main` unseen, and every reader then trusts the moved marker. A data binding (option 1) holds on every checkout and the host; a commit gate holds on one.

4. The legacy rule is a safety decision, and only one answer fails closed. "Admits the marked branch as today" keeps the hole for every old record. Measured: on origin/main the only plan carrying a `Spike approved:` record is `docs/plans/2026-10-12-design-work-proves-the-path.md`, State Released, so zero in-flight plans would lose an admission if a branchless record admits nothing. (Plan branches not yet on main were not measured.) That answers open question 4 and removes the cost of the fail-closed choice.

5. Uncertain cases that must end in a named answer, none of which the plan names: a record whose named branch no longer appears in the plan (renamed by `/plot-reslice` or by hand); a record whose branch exists but no longer carries the marker; a record with no branch (legacy); a record with an unparseable fourth field. Today an `unapproved` verdict is silent about why. Each case needs a named reason on the verdict or refusal (for example `spike-record-unbound`, `spike-record-moved`) so the board and pulse say why a previously eligible spike stopped, rather than reading as an ordinary unapproved plan.

6. Re-approval path. `approveSpike` refuses `spike-approved` while any record exists (`packages/domain/src/transitions/plan.ts:533-538`). Under option 1 with a fail-closed legacy rule, a plan whose record goes stale has no way back except a hand edit of a gated field. The plan must say whether `approveSpike` re-records when the record's branch differs from `spikeOf`, and under which receipt key.

7. `.plot/hold`: `--spike` clears only the approved branch's hold entry (`entry/approve.ts:664`, `:1018`). A moved marker leaves the new branch's hold in place if one was written, which partly blocks commits via `holdRefusal`. I did not verify that a Design plan always writes hold entries for every branch, so this is not a mitigation to rely on.

8. Line references: `plan.ts:493-494` and `:600-601` match origin/main; the record write is `plan.ts:600`, the branch `:601`. `eligible.ts:132-134` is `:132-133` now. Small drift, no false claim.

## Required amendments

A. A person chooses option 1 (bound record) as the fix; option 2 may be added as defence in depth but not instead.
B. Legacy rule: a record with no branch admits nothing, with a named reason. Cite the measurement in finding 4.
C. One domain function answers "the branch this plan's record licenses" (record branch AND `spikeOf` agree AND phase is design), and the slice replaces every site in finding 2 with it. List the sites in the plan so a Sonnet agent changes all of them; add a grep-based or unit test that no site still calls `spikeOf` next to `spikeApprovedRaw`.
D. Name the refusal/verdict reasons for finding 5, and state which surface (pulse, board card, `plot-dispatch` refusal, commit gate message) shows each.
E. State the re-approval path for a stale record (finding 6), including the state-gate receipt key.
F. Tests, each failing before and passing after: moved marker → `sliceVerdict` not eligible; moved marker → `phaseGateRefusal` refuses a commit on the new branch; moved marker → plangate refuses dispatch; renamed branch → same three; branchless record → admits nothing with its named reason; `approveSpike` writes the branch and `plot-plan-meta.sh` + parser read it back (the read-back check at `entry/approve.ts:702` compares the whole raw string, so the format change must survive it).
G. Rewrite the #3095 sentence in the present tense (finding 1).

## Decisions for a person

- Option 1, 2 or both (the plan correctly leaves this to a person; it must be answered before approval, because a Sonnet agent cannot pick).
- Whether `/plot-reslice` may rewrite the record's branch under a receipt, or a rename always needs a new `--spike` approval by a person. Under this lens the safer answer is re-approval.

## Ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:<file>` on eligible.ts, spike.ts, plan-walk-assembly.ts, transitions/plan.ts, gate.ts, phase-gate.ts, plangate.ts, board.ts, entry/approve.ts; `git grep` for `spikeApproved`, `Spike approved`, `.plot/hold` and record carriers under `docs/plans`; `gh pr view 3095`; `gh issue view 3101`. Ran no test, build, board, fleet or host write. Read only: fleet.ts:4106, draft-placement.ts and verdicts.ts were seen through grep lines, not read in full.
