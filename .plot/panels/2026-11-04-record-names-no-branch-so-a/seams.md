# Seams juror — record-names-no-branch-so-a (plan PR #3116, issue #3101)

Position: amend

## Findings

1. **The cited lines are true at origin/main.** `transitions/plan.ts:493-494` declares `branch` on `SpikeDecision`; `:600` writes `${input.on}, ${who}, ${input.channel}`; `:601` returns `branch: spike.branch`. `rules/eligible.ts:132-134` holds `spikeAdmitted`. `rules/spike.ts:37` is `spikeOf`. `workflows/plan-walk-assembly.ts:334` reads `spikeApproved` as "record non-empty".

2. **The plan names one reader; origin/main has at least eight.** Each one derives "the licensed branch" as `record non-empty` plus `spikeOf(slices)`, so each one follows a moved marker:
   - `packages/board/src/server/entry/gate.ts:561-580` `approvedSpikeOf` — the phase gate lets commits on that branch through (`rules/phase-gate.ts:178`, `:194`).
   - `packages/board/src/server/entry/plangate.ts:51-63` `spikeBranchOf` — the dispatch plan gate.
   - `packages/board/src/server/board.ts:1398-1401` `approvedSpikeOf` and `server/fleet.ts:4106` `approvedSpike` — board placement.
   - `packages/domain/src/rules/card-controls.ts:70`, `rules/spike-confirm.ts:39`, `rules/draft-placement.ts:13,37` — card states and placement.
   - `packages/board/src/server/entry/verdicts.ts:96,113` — the scan's verdict columns.
   - `workflows/plan-walk-assembly.ts:334` (the one the plan names).
   Option 1 that changes only `sliceVerdict`'s input leaves the phase gate and the dispatch plan gate admitting the moved branch while the queue refuses it. The readers then disagree, and the gate that matters most for an unattended worker (the commit gate) stays open. `docs/plans/2026-10-12-design-work-proves-the-path.md:77` already counted "five places" that admit the spike; the plan must name all of them.

3. **Ordering constraint with open PR #3105 (`bug/the-queue-hands-out-an-approved-spike`, OPEN, MERGEABLE).** #3105 adds `packages/domain/src/rules/slice-readings.ts`, which becomes the one place the scan walk and the queue read `spike` and `spikeApproved` (its diff: `const spikeApproved = plan.spikeApprovedRaw !== undefined && plan.spikeApprovedRaw !== ''`), and it rewrites `plan-walk-assembly.ts`, `eligible.ts` (makes `spike`/`spikeApproved` required `boolean | undefined`) and `fleet/src/shared/queue-reading.ts`. This plan's cited change point (`plan-walk-assembly.ts:334`) disappears when #3105 lands. The plan does not name #3105 at all, only plan PR #3095 (merged 2026-11-03). The slice must wait on #3105 and target `slice-readings.ts` after it merges.

4. **Overlap with open PR #3112 (`bug/plot-approve-reads-the-plan-from`).** It changes `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/approve.ts` and `packages/domain/test/approve-spike.test.ts`. Option 1 changes the record `approveSpike` writes and the read-back at `entry/approve.ts:702` (exact string compare against `decision.record`), and its tests live in `approve-spike.test.ts`. Expect a textual conflict; land #3112 first or state the order.

5. **Shell and corpus tier.** `skills/plot/scripts/plot-plan-meta.sh:1283` captures the record verbatim into `spike_approved_raw` (`:804`), and the parser decides nothing. `packages/domain/corpus/plan-store.corpus.test.ts:75` compares that field between shell and adapter. If option 1 parses the branch out of the raw string in the domain, no shell line changes, the shell-lines ratchet is untouched and the corpus pair holds. If an implementer instead adds a `spike_approved_branch` field to plot-plan-meta.sh, that adds shell lines and a new corpus field. The plan does not say which; it must say "parse in the domain".

6. **Option 2 meets two other seams the plan does not name.** The state gate (`rules/state-transition.ts:37-70`, `:207-225`, `:314`) keys on `## Status` fields; a marker on a branch line under `## Slices` is a new subject for it. `/plot-reslice` rewrites `## Slices` and has no receipt path, so option 2 refuses every reslice of a plan with a spike record unless the reslice controller gains a receipt. `skills/plot-reslice/SKILL.md` names the spike marker zero times.

7. **Open question 4 is answerable now.** `git grep` over `docs/plans` on origin/main finds zero plans with a `- **Spike approved:**` line, and one plan (`2026-10-12-design-work-proves-the-path.md`) with a `<!-- spike -->` marker. The legacy rule therefore binds no plan in this repository; it binds only adopting repositories, which Plot cannot measure from here.

8. **Docs that state the current contract.** `CLAUDE.md` (state-gate paragraph and the `--spike` sentence in "The Master Agent Uses The Controllers") and MANIFESTO Principle 2 ("a recorded spike approval licenses implementation of its one branch", per design-work-proves-the-path:75) describe the record. Option 1 changes its format; the slice must update `CLAUDE.md` and regenerate `AGENTS.md` with `./scripts/check-agents-md.sh --write`.

## Amendments required

- A. List every reader in finding 2 in the Design section, and require one domain function (for example `approvedSpikeBranch(raw, slices)`) that all of them call, with a test per reader that a moved marker and a renamed branch admit nothing.
- B. Add an ordering note and a `waits:` on #3105; name `rules/slice-readings.ts` as the change point after it merges. Name #3112 as a conflict and the order.
- C. State that the branch is parsed from `spikeApprovedRaw` in the domain, and that `plot-plan-meta.sh` and the plan-store corpus field do not change.
- D. Answer open question 4 with the measurement in finding 7.
- E. For option 2, name the `/plot-reslice` receipt path or state that a reslice re-approves.
- F. Name the `CLAUDE.md`/`AGENTS.md` and MANIFESTO text the slice updates.

## Decisions for a person

- Option 1, option 2 or both (the plan already defers this; it is a person's decision, and the slice cannot start without it).
- The rule for a record with no branch in adopting repositories (zero here).
- Whether a `/plot-reslice` rename re-approves or rewrites the record under a receipt.

## Ran versus read

Ran (read-only): `gh issue view 3101`, `gh pr list --state open`, `gh pr view 3095/3105/3112/3115`, `gh pr diff 3105`, `gh pr diff 3112` (grep for spike), `git grep` over origin/main for spike readers, shell scripts and plans, `git show` of the cited files. Read only: the plan, the cited source excerpts, `design-work-proves-the-path.md:75-77`. No test, build, fleet, board or host write ran.
