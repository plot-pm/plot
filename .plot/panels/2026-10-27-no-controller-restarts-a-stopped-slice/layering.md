# Juror verdict: layering and controllers

Position: amend
Evidence: Read the plan (docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md:1-57) and, in the same worktree, packages/domain/src/workflows/dispatch-verbs.ts:123-228 (an existing `restartWorker` domain workflow), its only caller packages/domain/test/workflows-dispatch-verbs.test.ts:84-132 (grep over packages/, skills/, test/ finds no production caller), skills/plot/scripts/plot-dispatch.sh:1013-1069 (`handover_refusal`) and :1898-1990 (the `--restart` block), packages/domain/src/rules/ci-suite.ts:326-347 (`NO_ENDPOINT` exempts `--restart` from the controller gate), test/reconcile/controller-gate.test.mjs:328-339 (a test asserts `--restart` is ungated), packages/domain/src/rules/controller-gate.ts:12,290-340 (`ControllerAction` and refusal routes), packages/domain/src/adapters/performer/performer-shell.ts:49-140 and packages/domain/src/ports/performer.ts:46 (the Performer port starts free agents only), packages/fleet/src/server/entry/continue-command.ts and packages/fleet/src/shared/continue-command.ts:72 (the board-free `continue` shape), packages/domain/src/rules/ending-action.ts:149,625 (`stopped` answers `leave`), plot-dispatch.sh:1887 (`--stop` writes `reason: stopped, actor: operator`), packages/domain/src/workflows/supervise.ts:285 (a marker tells a person to run `plot-dispatch.sh --restart`), and packages/domain/corpus/ (no restart corpus test). Ran grep and sed only; ran no fleet, board or dispatch command.

## (a) Problem statement

The measured facts (plan:21-26) are specific: a time, an exit code, the pulse fields, and the two controller refusals. The problem is the right one under *The Master Agent Uses The Controllers*: an action with no controller is "the gap" that the rule says to file. The statement has two factual errors that change the design. First, plan:28 says "nothing a master agent may call reaches it". On main the controller gate does NOT refuse `plot-dispatch.sh --restart`: `NO_ENDPOINT` lists `--restart` (ci-suite.ts:332-334), `actionFor` returns `null` for it (ci-suite.ts:344), and controller-gate.test.mjs:328-339 asserts that the call passes, with the reason "a refusal must name a route". So today the prohibition is a rule in CLAUDE.md, not a gate. Second, plan:46 says `ending-action.ts` "has no row for an ending that `--stop` writes". It has one: `stopped` answers `leave` (ending-action.ts:149), and `killedWorkerEnding` names "a person's `stopped` ending from `plot-dispatch.sh --stop`" as the desk's own account (ending-action.ts:625). The open question is whether that deliberate `leave` is wrong for a fleet-wide `--stop`, not that a row is missing.

## (b) Approach and new defects

Route 1 has the correct direction (plan:38, 41): controller, domain rule, port, adapter, script. Three points in it create defects if built as written.

1. A domain rule already exists and has no caller. `restartWorker` (dispatch-verbs.ts:177-228) decides exactly this action and refuses `branch-missing`, `no-worktree`, `reached-review`, `worker-alive` and `blocked-marker`. Its tests are its only callers. CLAUDE.md calls this "a defect to report" (the `setSprintState` precedent). The plan proposes "a domain rule that accepts only a claimed slice whose worker reads `failed` or `ended`" (plan:38). That is a second, narrower rule beside the first. The plan must call `restartWorker` and not write a new rule.

2. The proposed rule omits the PR refusal. The script and the existing rule ask the PR before the state word, because 5 of 5 `failed` desks held a PR (plot-dispatch.sh:1008-1015, dispatch-verbs.ts:46-56). A rule that accepts every `failed` desk restarts work that is in review. The PR reading comes from the `host` connector, so the controller needs the host port too, not only the pulse.

3. The domain rule and the script already differ. The script refuses a live loop whatever the state word (#1450, plot-dispatch.sh:1043-1051). `restartWorker` reads no loop and has no `loop-alive` refusal. No corpus test pairs the two (packages/domain/corpus/ has none for restart). If the adapter shells to `--restart`, the controller can report "decided: restart" and the script then refuses. The refusal then comes from the script and not from the domain, so the controller never decides it. *A Shell Script Asks The Domain* requires either one rule or a declared duplicate with a corpus test.

The port is not named either. `Performer` has `assignSlice` and `startFreeAgent` only (performer-shell.ts:49-140). The `worker-start` write that `restartWorker` emits with a branch has no applier: performer.ts:46 says the applier filters to `branch: ""`, and perform-fs.ts:61 skips it. The slice must add a port method (for example `restartWorker(branch)`) with a shell adapter and a sandbox adapter.

Route 2 (plot-fleetctl.sh restarts what `--stop` stopped, plan:39) puts a lifecycle decision in a 1396-line shell script. That breaks the layering rule and the shell-lines ratchet (`scripts/check-shell-lines.sh`). A later `plot-fleetctl.sh --start` would also restart desks with no domain refusal. If route 2 is kept, `--start` must call the route-1 controller bundle once per desk. Fleetd can also decide it through `endingAction` from the `stopped` ending's actor, which is a domain change.

## (c) Slices

The single slice (plan:51-53) lists domain rule, adapter, endpoint and bundle. It omits the following items:

- The gate. Remove `--restart` from `NO_ENDPOINT` (ci-suite.ts:332-334), give the refusal a route to `plot-restart-command.mjs <branch>` and `POST /api/restart` (controller-gate.ts:290-340), and invert controller-gate.test.mjs:328-339. Without this, the controller is optional and the plan ships a rule, not a gate (*Gates Over Rules*). The adapter's own spawn comes from node, so the Bash hook does not see it, and the gate does not block the controller itself. The gate's receipt is keyed by slug. A restart takes a branch, so the unowned-action receipt needs a branch form or a decision that the slug is enough.
- The port method and its two adapters (see (b)).
- The `loop-alive` reading in `restartWorker`, or a corpus test that declares the duplicate.
- The text that routes people to the script: supervise.ts:285 tells a person to run `plot-dispatch.sh --restart`. It must name the controller. test/reconcile/script-name-gate.test.mjs:142-157 covers that text.
- Route 2, if chosen, has no slice at all. Order it after route 1, because it calls route 1.
- The board-impact comment (plan:17) names a fleet-section row state. The domain must compute that state (for example a `restartable` card control) and a unit test must assert it, per "every rendered state is a domain property". The slice does not name it.

## (d) Open questions for a person

1. Route 1, route 2, or both? Recommendation: route 1 first. Route 2 only as a caller of the route-1 bundle, or as an `endingAction` row, and never as logic inside plot-fleetctl.sh.
2. A new rule or the existing `restartWorker`? Recommendation: the existing one, extended with `loop-alive`. Delete nothing, and duplicate nothing.
3. Which states are restartable: only `failed`/`ended`, or also `stalled`/`none` as `restartWorker` and the script accept today? Recommendation: keep the existing four. Narrowing the rule makes the controller refuse what the script accepts, and a person then goes back to the script.
4. Gate `--restart` in the same slice, or later? Recommendation: in the same slice. The ungated exemption exists only because no route existed (controller-gate.test.mjs:329-332), so the reason ends with this slice.
5. Should fleetd restart an operator-`stopped` desk on its own? Recommendation: no change to `stopped` → `leave` for a per-branch `--stop`. Decide separately whether a fleet-wide `plot-fleetctl.sh --stop` writes a different actor, so that `--start` can tell the two apart.

## (e) Position

amend. The direction is sound and the controller is the right fix. The plan must reuse the uncalled `restartWorker`, keep its PR-first refusal, name the port method, close the `NO_ENDPOINT` exemption in the same slice, and keep route 2 out of shell.
