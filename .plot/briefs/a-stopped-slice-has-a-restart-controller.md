## Implementation brief — no-controller-restarts-a-stopped-slice (wave 1: Restart controller)

- **Plan (canonical):** `docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2788 merged
- **Branch:** `bug/a-stopped-slice-has-a-restart-controller` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 of 2. `bug/a-fleet-start-restarts-what-its-stop-stopped` waits on this wave: it restarts through the controller this wave builds.

### What to build

Issue #2784. On 2026-10-27, `plot-fleetctl.sh --stop` sent SIGTERM to the worker of `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (exit 143). The pulse row then read `worker: failed`, `startability: someone-is-on-it`, and the slice sat parked for about 90 minutes. The only route to a new worker on that desk is `plot-dispatch.sh --restart <branch>`, and *The Master Agent Uses The Controllers* forbids a master agent from calling the script directly. Build the controller; `restart` becomes the tenth controller action.

1. **Rule.** Extend `restartWorker` (`packages/domain/src/workflows/dispatch-verbs.ts:177`). Add a `DeskLoop` live-loop reading (as `continueTarget` in `rules/continue-target.ts` has), a PR reading of `true | false | 'unanswerable'`, and an unattended refusal. Refusal order: PR (`reached-review`, `pr-unanswerable`), then live loop (`loop-alive`), then `PLOT-BLOCKED` marker (`blocked-marker`). Accepted states are `stalled`, `failed`, `ended`, `none`.
2. **Start path.** Extend `continueOnDesk` (`packages/fleet/src/shared/continuation.ts` and its callers) with a restart precondition. The restart holds `.plot-worker.continue.lock` (`continue-lock.ts`) across read, decide and start. At start it supersedes `.plot-worker.ending.json`.
3. **Controller.** `POST /api/restart {"branch":"<branch>"}` on the board (`packages/board/src/server/continue.ts` is the model) and `skills/plot/scripts/board/plot-restart-command.mjs <branch>` with no board, in the shape of `plot-continue-command.mjs`. The board row of a claimed slice whose worker is dead gets a Restart action; the domain computes that row state.
4. **One rule.** `--restart` in `plot-dispatch.sh` (mode block near `:1903`) asks the domain through the bundle, and `handover_refusal` (`:1028`) is deleted.
5. **Gate.** Remove `--restart` from `NO_ENDPOINT` (`packages/domain/src/rules/ci-suite.ts:327-333`), route its refusal to `plot-restart-command.mjs <branch>` and `POST /api/restart`, flip `test/reconcile/controller-gate.test.mjs:328-339`, and spend the receipt on the restart path. `supervise.ts:285` names the controller, not the script.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Extend `restartWorker`; write no new rule.** It already exists and only its unit tests call it. A second rule beside the shell's `handover_refusal` is the duplicate the plan removes.

**One rule, not a declared duplicate.** `--restart` runs once per operator command, so the cost rule in *A Shell Script Asks The Domain* applies: a bundle answers in 39 ms against 34 ms for `node -e ''`. Do not keep `handover_refusal` as a corpus-tested twin.

**Refusal order is the script's: PR, then loop, then marker.** A live loop refuses `loop-alive` whatever the state word says (`plot-dispatch.sh:1855`), because the state word alone would have restarted five live loops. The existing `running` → `worker-alive` arm stays for the state word; `loop-alive` is the new reading beside it.

**Host unreachable refuses `pr-unanswerable`.** Absent is not false: an unanswered PR check is not *no PR*. Never read it as `false`.

**`finished` stays out.** A finished worker with unlanded work is a desk fact the reaper and `continue` handle. Do not widen the set.

**The old ending is superseded at restart, not deleted by hand.** A restarted worker that dies without writing an ending then reaches `killedWorkerEnding`, instead of reading the previous `stopped` ending and answering `leave`.

**`stopped` still answers `leave`** (`rules/ending-action.ts:149`). Do not touch it: a person's stop is a decision. fleetd never restarts a stopped slice by itself. Slice 2 owns the fleet-stop list; add nothing for it here.

**The gate changes in this slice,** because the refusal must name a route and this slice creates it.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist because a naive implementation passes without them:

- `restartWorker` refuses in the order PR, loop, marker. A fixture with an open PR, a live loop and a marker at once must refuse `reached-review`. A fixture with a live loop and a marker must refuse `loop-alive`. These catch a reordered chain.
- `loop-alive` refuses with state `failed` and a live loop reading. It catches a rule that reads only the state word.
- A restart and a continue on one desk serialise on `.plot-worker.continue.lock`: both started at once, one new pid. It catches a restart that takes the lock after its read.
- A restarted worker killed without an ending reaches `killedWorkerEnding`. It catches an ending left in place.
- `plot-restart-command.mjs` exits 2 with no branch and refuses `unknown-branch` and `no-worktree` by name. On a fixture desk with a `stopped` ending and exit 143 it starts a new pid.
- The Restart row state is asserted on the domain property in a unit test, with one browser test proving the button shows.
- `controller-gate.test.mjs` refuses a bare `plot-dispatch.sh --restart` and allows it after the controller receipt; a second `--restart` with the receipt spent is refused.
- `scripts/check-shell-lines.sh pr` reports fewer lines than the merge base.

Plus: tests that run a built bundle need `pnpm build:board` first; restore the generated bundle before push (`scripts/check-no-bundle-diff.sh`). A new bundle and a new `scripts/`-listed helper each need their `skills/plot/scripts/README.md` row (`scripts/check-helper-table.sh`). Update the `CLAUDE.md` controller list (`restart` joins the actions with a board-free bundle), then run `./scripts/check-agents-md.sh --write`. Add a changeset (description first, `bumps:` block last, with `plan:`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Deleting `handover_refusal` pays for the shell this slice adds; add no other shell. Write new domain and fleet functions as arrows, with TSDoc that states what the export does and returns, not the history of the decision.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `restartWorker` and its tests, the restart precondition on `continueOnDesk`, the board route and `plot-restart-command.mjs`, the Restart row state, the `--restart` mode in `plot-dispatch.sh`, and the gate rows in `ci-suite.ts` and `controller-gate.test.mjs`.

Do not edit `plot-fleetctl.sh`, `--stop`'s ending, or any stop list: that is `bug/a-fleet-start-restarts-what-its-stop-stopped`, which waits on this wave. Other branches in flight, verified at dispatch time from the pulse: `bug/a-local-only-empty-claim-branch-has-a-controller` (reap entry and `rules/sweepable.ts`) and `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (merged). Neither touches the files above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
