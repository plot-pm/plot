# Seams juror — the-pulse-s-tracer-flag-means

Position: amend

Lens: where the change meets other plans, open PRs and branches, declared shell/domain duplicates and the corpus tier. All references are to `origin/main` at `e54e53815` unless a PR is named.

## Findings

1. **Open PR #3105 (`bug/the-queue-hands-out-an-approved-spike`, plan `registry-never-hands-out-an-approved`, Approved, active) edits the same lines.** Its diff to `packages/domain/src/workflows/plan-walk-assembly.ts` rewrites `:317-340`: it removes `spikeCounts`/`spikeSliceOf` and keeps one `planSpikes` sum. Its plan states the reason (`docs/plans/2026-11-03-registry-never-hands-out-an-approved.md:63`): "`tracer: planSpikes > 0` (`:391`) still needs the marker count, so the walk keeps that one sum", and it names #3102 as a follow-up (`:101`). This plan does not name #3105. Consequences: (a) a textual conflict in `plan-walk-assembly.ts` for whichever lands second; (b) the plan's line references `:337-338` and `:391` go stale when #3105 merges; (c) under Option A the `planSpikes` sum that #3105 keeps becomes dead code, and the slice must delete it. The plan states none of this.

2. **The board already holds both meanings at once, and the plan names only the pulse.** `packages/board/src/server/board.ts:1457` and `:2637`/`:2673` pass `meta.tracer` (the parser's `Tracer: yes`) to `decidePlanStatus`/`phaseOfPlan`. `packages/board/src/server/fleet.ts:6616` passes `plan.tracer` from the pulse plan row (the spike-marker count) to `phaseOfPlan` for each branch row. So on `main` a plan with a marker and no `Tracer:` line has its branch rows in the Design column while its plan status reads `deliverable`, not `proven`. This is a second visible symptom of #3102 and the plan's "Board impact: none" comment hides it. Option A fixes it; Option B leaves it.

3. **Option B's claim "the parser's `tracer` key and the `Tracer: yes` line have no reader" is false.** Readers of the parser key on `main`: `packages/board/src/contract/schema.ts:167-168` (`PlanMetaSchema.tracer`), `board.ts:1457`, `:2637`, `:2673`, `:2731`; `packages/fleet/src/shared/auto-verify.ts:231`, `:315`, `:441` feeding `rules/auto-verify.ts:165` (`refuse('tracer')`) and `rules/verification-record.ts:129`; `rules/phase.ts:45-46`, `:80`; `rules/workflow-phases.ts:131-149`. Under Option B every one of these keeps the `Tracer: yes` meaning, so the split moves from pulse-vs-schema to pulse-vs-board-vs-auto-verify. Option B, as written, is not a one-meaning outcome.

4. **The corpus tier records the drift as a decision, and Option A must reverse it.** `packages/domain/corpus/plan-store.corpus.test.ts:76-77` lists `'tracer'` in `KNOWN_UNCARRIED` with the comment "The scan carries it to the pulse plan; no PlanStore reader decides on it." That comment is false today (the pulse takes the flag from markers, not from the parser key). Under Option A `PlanRecord` carries `tracer`, so the key moves to the corpus `FIELDS` mapping and leaves `KNOWN_UNCARRIED`. The test at `:215-233` checks only one direction (a key on neither list fails), so a key on both lists passes silently. The plan does not name this file; an unattended agent can leave the stale entry and the corpus still passes.

5. **Option B's open migration question has a measured answer.** `git grep -i "tracer:" origin/main -- docs/plans` finds no plan whose `## Status` carries `Tracer: yes`; the only hits are prose in `2026-10-12-design-work-proves-the-path.md` and `2026-10-12-the-fleet-verifies-what-it-delivered.md`. The plans with real `<!-- spike -->` branch markers are Released. So neither option changes the delivery of a live plan today, and the open question can close with that fact.

6. **D15 is the design authority for the meaning.** `docs/plans/2026-10-12-design-work-proves-the-path.md:28`, `:55`, `:105`, `:176` define a tracer plan by `Tracer: yes` and put `tracer` on the pulse `PlanSchema` from that line; `2026-10-12-the-fleet-verifies-what-it-delivered.md:88` builds on the same field. Option B contradicts two Released plans; Option A restores what they state.

7. **No declared shell/domain duplicate exists for this flag.** `plot-fleet-scan.sh` carries no `tracer`; `plot-plan-meta.sh:806`/`:1284` is the only shell producer, and the domain reads it only through the `PlanStore` adapter. No corpus pair beyond finding 4 is affected. Other open PRs (#3109–#3114, #3116, #3076, #3080) touch none of the named files; #3116 (Draft plan, `Spike approved:` record) touches spike readings in concept but changes only plan files today.

## Amendments required

- Name #3105 as an ordering constraint: the slice builds on top of #3105 after it merges (or rebases onto it), deletes the `planSpikes` sum #3105 keeps if Option A is chosen, and cites line numbers from the post-#3105 file or by symbol name rather than `:337-338`/`:391`.
- Add the board's two readers (`board.ts:1457`/`:2637`/`:2673` vs `fleet.ts:6616`) to Motivation, and replace "Board impact: none" with the column change a marker-only plan sees.
- Strike or correct Option B's "no reader" claim; list the readers in finding 3 and state that Option B must also move them, or drop Option B.
- Add `packages/domain/corpus/plan-store.corpus.test.ts` to the slice under Option A: move `'tracer'` from `KNOWN_UNCARRIED` to the mapped `FIELDS`, so the corpus compares the parser's key to `PlanRecord.tracer`.
- Close the second open question with the measured fact in finding 5.

## Decision for a person

- Option A or Option B. Through this lens Option A is the only option that yields one meaning without touching five more readers, and it agrees with D15.

## What I ran versus read

Ran (read-only): `git fetch`, `git grep`/`git show` on `origin/main`, `gh pr list`, `gh pr diff --name-only` for #3105, #3110–#3112, #3114, #3116, `gh pr diff 3105` for `plan-walk-assembly.ts`, `gh issue view 3102`. Read: the plan, the issue, the corpus file, `auto-deliver.ts:268-300`, `board.ts:1450-1460`, `fleet.ts:6595-6620`. Did not run any test suite.
