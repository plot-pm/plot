# Round 3 — Moderation

**Subject:** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `9f53bb90e`
**Lenses:** estate, contradiction, deliverable, cost
**Gate:** each verdict checked with `plot-panel.mjs check Position "proceed,amend,reject" <lens>`; all four exit 0
**Reconcile:** `unanimous	amend	estate,contradiction,deliverable,cost`

## Round-2 findings

| Lens | Answered | Partly answered |
|---|---|---|
| estate | 8 of 8 | none (two answers bring new problems, below) |
| contradiction | 4 of 4 | none (one leftover doc comment in `entities/ending.ts`) |
| deliverable | 7 of 8 | 1: the slice-1 offset is named but does not hold |
| cost | 5 of 7 | 2: the ratchet offset (slice 4 names none), the e2e reason (wrong) |

## What each juror looked at

All four read code and ran no test. Estate re-ran every Motivation count and found them true. Cost timed CI steps on 4 runs, measured `claude` RSS (743 MB) and `plot-registryd` (60 MB after 2 days), and counted the desks, logs and ending files left on this machine. Deliverable ran `plot-plan-meta.sh` (exit 0). Contradiction traced the exit codes to each `write_ending` site.

## New findings, by subject

**1. The CI wait's "settle on a containing tip" has nothing to settle on, and settles on the wrong build (estate 4, contradiction 3, deliverable 1).** Three lenses found it from three sides. The BuildMonitor asks only about the desk's local `HEAD` (`plot-build-monitor.sh:225-227`), `checksVerdict` accepts only a finding for that `HEAD`, and `wait_for_checks` never fetches. A tip that contains the agent's commit can also carry someone else's commit on top. That is #1199's own case (`0e64fafd` on `f743e573`), and a failure there would spend the agent's correction budget.

**2. The `agentState` column is wrong wherever a PR exists (estate 1, contradiction 1).** `taskState` returns `finished` first when there is a PR (`rules/task.ts:88`). `deskState` reads a marker before a merge. The table test promised in slice 2 would stop on its own table.

**3. The slice-1 offset breaks two tests and is too small (deliverable 2, estate 13, cost 4).** The `desk_hold_reason` arms it removes are asserted at `deskreset.test.mjs:98-100` and `:118-124`. The slice adds about 10 to 12 lines against the 7 it names.

**4. The prompt leaves the agent's process group (cost 1).** A `detached: true` prompt starts its own group, so the #1084 group stop (`plot-dispatch.sh:1849-1867`) no longer reaches `claude`. A crashed loop would leave a 743 MB orphan, and no failure kind counted it.

**5. Ports and writes the plan names wrongly or leaves out (estate 5, 6, 7, 8, 9; contradiction 4).**
- `runBounded` was placed on `processes`, which reads the process table and can destroy nothing. `performer` starts processes.
- `manifest-clear` deletes the manifest. The loop clears only its branch.
- The start-retry budget raises `attempts`, the counter the supervisor reads, so there are three counts, not two.
- The write table left out the correction file, the limited record, `seal_declaration`, `record_slice_spend`, `move_worker_record` and `update_manifest_on_hop`. It also left out the existing `agents`, `trees.add`, `refs.contains` and `agent-resume`.
- The restart's self-check spawn, `git status`, ancestry read and `process.execve` reached no named port.

**6. The restart's clock, bundle and ancestry kind (estate 10, 11, 12; contradiction 6).**
- `Worker bound` applies per prompt run and per free wait, never to the loop's life.
- In this repository the launcher that runs is the desk's copy.
- The ancestry read licenses a restart, so it is `evidence`, not `prefilter`.

**7. Endings that change silently (estate 2, 14; contradiction 2).**
- Today a free wait at `Worker bound` writes no ending.
- Today a spent budget writes `unstarted`, exit 1.
- `markerRecordsWork` reads the desk, never the marker's text.

**8. The baseline and the CI leg cannot run as written (cost 2, 3, 5; deliverable 3, 4, 5, 6).**
- `plot-reap.sh:144-147` removes the logs the baseline was to count.
- The expensive CI step is the contract tests (408 to 502 s against 720 s), not e2e (40 to 45 s).
- `plot-config.sh` has no environment override for the `js` leg.
- No slice sets this repository's key to `js`.
- Failure kind 4 has no source.
- The board package has no coverage tool.
- Five "per desk" cells cannot be asserted.

**9. Citations (estate; contradiction 5).**
- `agentState` is at `agent-state.ts:132-143`.
- `plot-worker-state.sh` has 14 shell callers and 3 domain adapters. Round 2 flagged this too, and it was not fixed then.
- `schema.ts` lives under `contract/`.
- Slice 7's "loop's half" of `corpus/agent-state.corpus.test.ts` does not exist.

**Disagreements:** none on position. On finding 1 the lenses proposed different fixes. Deliverable wanted the shell loop to end on any moved tip and the settle to move to `BuildPort`. Estate and contradiction wanted the settle dropped. The amendment takes both: the wait reads the agent's own commit and ends on any moved tip. The comparison is equality, so the CI wait needs no ancestry reading at all.

## What the four lenses had in common

Round 3 found about as many problems as round 2, and nearly all are new claims in the round-2 amendment that did not hold against the code. Each amendment answers the findings by describing the shell loop in more detail: line numbers, write sites, counter names. Each new detail is a new claim the next round can check. The plan now cites about 60 code locations. A round 4 run in the same way will likely find citations again. The next step is not a fourth round of the same kind. Ask instead which of these claims belong in the slices' briefs, where an implementer verifies them against the code of that day.

No juror asked whether slice 1 needs this plan. It changes only the shell loop, depends on no other slice, and fixes a failure measured twice. The amendment records this as an open question.

## Outcome

Amend. The amended plan answers every finding above. Each answer is recorded in the plan.
