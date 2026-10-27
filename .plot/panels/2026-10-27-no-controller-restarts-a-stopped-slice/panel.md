# Panel moderation: no-controller-restarts-a-stopped-slice, round 1

- **Subject:** `docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md` at `6e67d9c3a` (plan PR #2788, issue #2784)
- **Jurors:** layering, operator, safety, testability (opus, one shared rubric, the lens as the only varied line)
- **Commitment:** `Position` in `proceed|amend|reject` (reconciled); `Evidence` as free text
- **Gate:** `plot-panel.mjs check Position proceed,amend,reject <lens>` exited 0 for all four; no send-back
- **Reconcile:** `unanimous	amend	layering,operator,safety,testability`
- **Base:** `origin/main` has 0 commits past the plan branch's merge base, so every file:line the jurors cite reads the same on main.

**The `Evidence` label is not gated.** `plot-panel.mjs check` takes a closed vocabulary of at least two words for every label and refuses `.+` with exit 2. All four files carry an `Evidence:` line at line 4, which the moderator read; no script checked it. A caller that wants free-text evidence gated needs a mechanism change, or a vocabulary such as `executed|read` as `/plot-deliver` uses.

## What each juror ran and what it read

| Juror | Ran | Read |
|---|---|---|
| layering | grep and sed only | `restartWorker` (dispatch-verbs.ts:123-228) and its test-only callers, `NO_ENDPOINT` (ci-suite.ts:326-347), controller-gate.test.mjs:328-339, the `Performer` port and shell adapter, `continue-command.ts`, ending-action.ts:149,625, supervise.ts:285 |
| operator | grep and sed only | `--stop`/`--restart`/`handover_refusal` in plot-dispatch.sh, plot-fleetctl.sh `--stop`/`--start`, ending.ts:117-128, ending-action.ts, verdict.ts:56, `continueOnDesk`, registryd.ts start-fresh, desk-fs.ts:181-190, the 2026-08-27 plan |
| safety | **`plot_worker_state` on three hand-built sandbox desks**: exit 143 with a dead pid reads `failed`; a dead pid with no exit file reads `ended`; a pid file naming a live unrelated process with no manifest reads `running` | `--restart` end to end, `handover_refusal`, `reached_review`, `start_worker`, plot-worker-state.sh, `restartWorker`, continue-target.ts, continue-lock.ts, registryd.ts |
| testability | **`check-plan-headings.sh` (pass), `check-shell-lines.sh pr` (18437 = 18437 at merge base), `check-shell-lines.sh --per-file`** (plot-fleetctl.sh 1091, plot-dispatch.sh 2262 commands) | the sibling plan's `## Done when`, ending-action.ts, ending.ts, plot-dispatch.sh, plot-fleetctl.sh, controller-gate.test.mjs, continue-command.test.ts, MANIFESTO.md checklist |

Only safety executed the code under judgement. The stale-ending defect (below) rests on reading: operator says so explicitly ("I did not execute this"), and safety inferred it from the same three lines without a sandbox run. No juror ran a TypeScript test, because the worktree has no `node_modules`.

## What all four found

These points appear in every verdict, each reached independently with different citations:

1. **The gap is real and route 1 has the right shape.** No board endpoint and no board-free bundle reaches `plot-dispatch.sh --restart`; a controller with named refusals is the fix *The Master Agent Uses The Controllers* asks for.
2. **The plan misstates `ending-action.ts`.** plan:30 and Open Question 2 say no row answers the ending that `--stop` writes. `stopped` answers `leave` on purpose (ending-action.ts:149; plot-dispatch.sh:1882-1887, "a person's stop is recorded as one"). The question is whether to overturn a recorded decision, not to fill a missing row.
3. **The proposed rule is narrower than the script and drops the PR-first refusal.** plan:38 accepts `failed`/`ended` with a desk. `handover_refusal` refuses an open or merged PR first (5 of 5 `failed` desks held one), then a live loop (#1450), then a `PLOT-BLOCKED` marker, and accepts `stalled`, `failed`, `ended`, `none`.
4. **Route 2 cannot tell a fleet stop from a person's stop.** `plot-fleetctl.sh --stop` calls `plot-dispatch.sh --stop` per branch (plot-fleetctl.sh:1296), which writes a byte-identical `stopped`/`operator` ending. As written, `--start` would restart a slice a person parked deliberately.

## Where the jurors disagree

**1. Who restarts a slice that a fleet-wide stop stopped.** This is the panel's one disagreement on substance.
- operator and safety: fleetd never restarts a `stopped` desk by itself. Keep `stopped` → `leave`, which the 2026-08-27 plan chose against "restarting stalled work on a five-second timer". Route 2 is a later slice that calls the route-1 controller only for the branches `fleetctl --stop` recorded.
- testability: give a fleet stop its own actor or detail in the ending, and let `endingAction` restart it on the next tick. A person's single-slice stop keeps `leave`. Its argument is that route 1 alone leaves every `--stop`/`--start` cycle needing one manual restart per desk.
- layering: accepts either form, provided the decision sits in the domain (`endingAction` row or a caller of the route-1 bundle) and never in plot-fleetctl.sh.
- The named problem: whether a fleet-wide pause is a person's decision about each slice. operator and safety read it as one; testability reads it as a machine event that a person did not aim at any single slice.

**2. Which code path starts the worker.** Four answers, not one:
- layering: call the existing `restartWorker` (dispatch-verbs.ts:177) and add a `Performer` port method with a shell adapter to `--restart` and a sandbox adapter.
- safety: extend `restartWorker` with a loop reading and an `unanswerable` PR reading, and take the existing `.plot-worker.continue.lock`.
- operator: extend `continueOnDesk` with a restart precondition, which already holds the lock and the manifest refusals and keeps one desk-start path in TypeScript.
- testability: delegate, so `--restart` asks the domain and drops its shell copy of `handover_refusal`; this lowers the shell count the ratchet measures.
These are compatible in part (all reject a second, narrower rule), but they choose different owners for the spawn and different lock stories.

**3. Points raised by one juror only.** No other juror contradicts them; none of the other three looked:
- operator: the "five free desks stayed idle" symptom is not caused by this gap. A free desk takes only an `open` slice by design, and `fleetctl --stop` leaves detached free desks running. Neither route makes an idle desk pick up the slice. The plan's motivation presents it as the cost of the gap.
- operator: a receipt for a board-free restart is never spent, because the only spend site is the fan-out (plot-dispatch.sh:4218) and `--restart` exits before it.
- operator: the Changelog promises route 2, but the only slice builds route 1.
- safety: `reached_review` answers "no PR" when the host cannot be asked (plot-dispatch.sh:1760-1770), so a controller called during a host outage restarts work in review.
- safety: on a desk with no manifest, a reused pid reads `running` (shown in the sandbox); the `worker-alive` refusal then advises `--stop`, which sends SIGTERM to an unrelated process group.
- safety: no rule says whether a restart refuses under `PLOT_UNATTENDED=1`.
- layering: supervise.ts:285 tells a person to run `plot-dispatch.sh --restart`; that text must name the new controller.
- layering: the controller gate exempts `--restart` today (`NO_ENDPOINT`, ci-suite.ts:332), and controller-gate.test.mjs:328-339 asserts it passes. testability and operator found the same; safety reported the installed 2.28.1 hook refusing a grep that named the script. Both are true: the installed hook refuses any command line that names `plot-dispatch.sh` without a listed flag (the moderator's own `git diff -- <path>` was refused the same way), while repo `main` exempts the `--restart` flag. The slice must remove the exemption, flip that test and route the refusal to the controller.
- testability: the plan has no `## Done when`; it lists per-layer failing tests that would make it checkable. testability also raises whether restarts count against `--start N`.
- operator and safety (two jurors): `--restart` leaves the old `stopped` ending in place, so a restarted worker that later dies without an ending reads as a person's stop and fleetd answers `leave`. Both reached this by reading; it needs a test before anyone relies on it.

## What a unanimous panel might all have missed

The four lenses share the same inputs: the plan text and the code at one commit. That leaves three blind spots:

- **No juror checked the incident itself.** Nobody read the real desk's `.plot-worker.ending.json`, the fleetd log, or the pulse at 15:06 to confirm that the stranded desk held a `stopped` ending and not an absent one. The whole diagnosis (fleetd answered `leave` because of `stopped`) is inferred from code. If the ending was absent, `killedWorkerEnding` should have fired, and the real defect is elsewhere.
- **No juror asked about a second machine.** A claim from another machine reads `elsewhere`. None of the four asked how a restart refuses when the claim's desk lives on another host, or when a local desk outlived a claim that moved.
- **All four take a controller as the answer.** They did not test the cheaper alternative the operator's finding opens: if the 90-minute cost came mostly from no open work for free desks, the fleet-stop fix (disagreement 1) may matter more to an operator than the controller does. The panel did not weigh the two by cost.

## Decisions for the operator

1. **Route.** Either build route 1 only (a `restart` controller, board endpoint and board-free bundle) and drop route 2 from the Changelog, or build route 1 plus a fleet-stop fix as a second slice after it. Panel recommendation: route 1 now. Add a second slice only together with decision 2, and never as restart logic inside plot-fleetctl.sh (the shell ratchet grants no exemption).
2. **A fleet-wide stop.** Either a `stopped` ending from `plot-fleetctl.sh --stop` answers `leave` exactly as a person's stop does, with `--start` restarting only a recorded stop list through the route-1 controller, or a fleet stop writes its own actor and `endingAction` restarts it on the next tick. The panel is divided: operator and safety recommend the first (fleetd never auto-restarts a stop); testability recommends the second. Both sides agree a person's single-slice `--stop` keeps `leave`.
3. **The rule.** Either extend the existing uncalled `restartWorker` (dispatch-verbs.ts:177), or write the new narrower rule plan:38 describes. Panel recommendation (unanimous): extend `restartWorker`; add the live-loop reading it lacks.
4. **Restartable states.** Either `failed` and `ended` only, or the script's set (`stalled`, `failed`, `ended`, `none`) behind the PR, then loop, then marker refusals. Panel recommendation (unanimous): the script's set and order; `finished` stays out.
5. **One rule or a declared duplicate.** Either `plot-dispatch.sh --restart` asks the domain and its shell copy of `handover_refusal` goes, or both stay and a corpus test in `packages/domain/corpus/` pairs them. Panel recommendation: delegate (testability), which also lowers the shell count; no juror argued for the duplicate.
6. **The start path.** Either the controller reaches `--restart` through a new `Performer` port method and shell adapter, or it extends `continueOnDesk` with a restart precondition. Panel recommendation: divided. operator recommends `continueOnDesk` (one start path in TypeScript, lock and manifest refusals already present); layering recommends the port method. Whichever path is chosen must take the existing `.plot-worker.continue.lock` (safety).
7. **Host unreachable during the PR check.** Either proceed as `reached_review` does today, or refuse with `pr-unanswerable`. Panel recommendation: refuse in the controller (safety; no juror disagreed).
8. **The old ending.** Either the restart clears or supersedes `.plot-worker.ending.json` at start, or it leaves it. Panel recommendation: clear it, with a test that a restarted worker killed without an ending reaches `killedWorkerEnding` (operator, safety).
9. **The gate.** Either remove `--restart` from `NO_ENDPOINT`, flip controller-gate.test.mjs:328-339 and add a receipt spend on the restart path in the same slice, or leave the script ungated. Panel recommendation: the same slice.
10. **The motivation.** Either keep "five free desks stayed idle" as the cost of this gap, or restate it: a free desk takes only open slices, so neither route changes idle desks. Panel recommendation: restate, and correct the "no row" claim at plan:30 and Open Question 2.
11. **Unattended use.** Either a restart refuses under `PLOT_UNATTENDED=1`, as `plot-needs-design.mjs` does, or a fleet agent may restart a sibling's desk. Panel recommendation: refuse (safety; no other juror addressed it).
12. **Acceptance criteria.** Either add `## Done when` with failing tests per layer (domain refusals per state, bundle refusals and a started pid on a fixture desk, the gate flip, the 2026-10-27 reproduction), or approve without one. Panel recommendation: add it before approval (testability).
