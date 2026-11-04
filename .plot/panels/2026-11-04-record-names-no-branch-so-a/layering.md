# Layering juror — 2026-11-04-record-names-no-branch-so-a

Position: amend

Lens: controller → domain → port ← adapter, every rule in the domain, read the index, lifecycle through controllers, no shell growth.

## Findings

1. **The plan's reader inventory is incomplete, so "every reader gets it" is false as written.** The plan names one reader: `sliceVerdict` via `plan-walk-assembly.ts:334`. On origin/main `e54e53815` the question "which branch does this `Spike approved:` record license" is answered independently in at least five places, three of them outside the domain:
   - `packages/board/src/server/board.ts:1398` `approvedSpikeOf` — `spike_approved_raw.trim() !== ''` then `spikeOf(meta.slices)`. Feeds `approvedSpikes` in `fleet.ts:6433` (fleet placement).
   - `packages/board/src/server/entry/gate.ts:566` `approvedSpikeOf` — the phase gate's spike exception (a commit on the spike branch while the plan is Design).
   - `packages/board/src/server/entry/plangate.ts:55` `spikeBranchOf` — the dispatch plan gate.
   - `packages/domain/src/workflows/plan-walk-assembly.ts:334` — presence test, then `sliceVerdict` (`eligible.ts:132-134`).
   - `packages/domain/src/rules/spike-confirm.ts:39`, `rules/card-controls.ts:70`, `transitions/plan.ts:533` — presence tests (these ask "is there a record", which stays correct).
   - `skills/plot-implement/SKILL.md:69` — the same rule in prose, read from `spike_approved_raw` and the `spike` flag by an agent.
   Option 1 implemented only in the domain verdict leaves the board placement, both gates and `/plot-implement` admitting a moved marker. That is the defect surviving in the readers that act (dispatch, commit gate, start).
2. **The three board copies are already a layering defect.** `approvedSpikeOf` (twice) and `spikeBranchOf` compose `spike_approved_raw` + `spikeOf` in board entries. CLAUDE.md "No domain-specific code or behaviour lives outside the domain." The fix is the moment to collapse them into one domain rule.
3. **Option 2 puts the rule in the wrong layer.** `plot-state-gate.sh` is an 18-line launcher that `exec`s `board/plot-gate.mjs state` (`gate.ts`). A marker-move refusal there is a board-entry decision over a diff, it protects one write path (a commit through the hook), and it leaves every reader deciding from presence. It does not grow the shell, but it does not put the rule in the domain either. Option 1 is the layering-consistent choice; option 2 is at most an additional guard.
4. **Parsing belongs in the domain, not in awk.** `plot-plan-meta.sh:1283` stores the record raw (`spike_approved_raw`, comment at `:286` "Read by the spike rules, never decided here"). Keep that: split the branch out of the raw record in a domain function. Adding a `spike_approved_branch` field to the awk parser would grow the shell and break `scripts/check-shell-lines.sh`'s ratchet unless lines are removed elsewhere.
5. **The write path already routes through the controller.** `approveSpike` (`plan.ts:493-601`) decides and returns `branch`; `approve.ts:702` re-reads and compares `spikeApprovedRaw.trim() !== decision.record`, so a record that carries the branch keeps that check working without change. `plot-approve.mjs --spike` and `POST /api/approve {spike:true}` are the controllers; nothing needs a hand write. Good.
6. **No index question arises.** The record is plan text read from git, not a bought host answer. Nothing here should read or write `.plot/state/index/`.

## Amendments required

1. Choose option 1 (person's call, see below), and state it in `## Design`.
2. Add one domain rule, for example `licensedSpike(record: string, slices): string | undefined` in `packages/domain/src/rules/spike.ts`, that parses the branch from the record and returns it only where it equals `spikeOf(slices)?.branch`. Name it in the plan.
3. Name every caller that must switch to it: `plan-walk-assembly.ts:334` (the `spikeApproved` reading), `board.ts:1398`, `entry/gate.ts:566`, `entry/plangate.ts:55`. Delete the three board copies rather than patch them.
4. Change `skills/plot-implement/SKILL.md:69` and `:85` to name the record's branch, and `skills/plot-approve/SKILL.md:379` for the new record format. Bump both skills in the changeset.
5. State that `plot-plan-meta.sh` is not changed (raw field stays raw), so the shell-lines ratchet is untouched.
6. Tests: one per switched reader that fails on origin/main — a moved marker and a renamed branch each read `unapproved` in `sliceVerdict`, absent from `approvedSpikes`, refused by `plangate`, and refused by the `phase` gate. Update the fixtures that write a branchless record (`test/reconcile/approve.test.mjs:329,899`, `approve-entry.test.mjs:217`, `scan-spike-readings.test.mjs:56,88`, `spike-marker.test.mjs:52`, `state-gate.test.mjs:628`, `test/e2e/spike-dispatch.test.mjs:119`) according to the legacy rule.

## Decisions that need a person

- Option 1, option 2 or both. Through this lens: option 1, with option 2 optional.
- The legacy rule for a record with no branch. Through this lens the fail-closed answer (admits nothing; re-run `/plot-approve --spike`) keeps the rule in one place; "admits the marked branch as today" keeps the defect for every existing record. Measure the in-flight records first (`git grep -l 'Spike approved:' origin/main -- docs/plans`), as the plan's own open question says.
- Whether `/plot-reslice` rewrites the record under a receipt or requires re-approval. A rewrite is a second writer of a receipted field and needs a controller; re-approval needs none.

## What I ran versus read

Ran (read-only): `git fetch`, `git show origin/main:<file>` for `eligible.ts`, `spike.ts`, `plan-walk-assembly.ts`, `plan.ts`, `board.ts`, `entry/gate.ts`, `entry/plangate.ts`, `entry/verdicts.ts`, `plot-state-gate.sh`; `git grep` for `spikeApproved`, `spike_approved`, `Spike approved` across packages, skills and tests; `gh issue view 3101`; `gh pr view 3095`. Read: the plan, the issue, CLAUDE.md. Line references in the plan (`eligible.ts:132-134`, `spike.ts:37-41`, `plan-walk-assembly.ts:334`, `plan.ts:493-494,600-601`) match origin/main `e54e53815`. No tests run, no host writes.
