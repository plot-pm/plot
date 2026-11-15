## Implementation brief — tickets-for-the-release-and-loose (wave: Loose ends)

- **Plan (canonical):** `docs/plans/2026-11-08-tickets-for-the-release-and-loose.md` on main; the design is `docs/superpowers/specs/2026-11-08-delivery-tab-design.md`, section "Tickets and loose ends"
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/loose-ends-show-under-unblock` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review through the `plot/review` status, as for every slice of this plan

This is the last wave. Its dependency, `feature/delivery-tab-sections` (#3267), is merged. The three sibling slices `the-release-line-counts-tickets` (#3391), `sprint-work-records-the-ticket-it-opened` (#3390) and `tickets-reach-input-to-the-fleet` (#3392) edit the same Delivery tab; nothing here waits on them.

### What to build

A PR or branch that no plan names and nobody works on shows under **You › Unblock**, with the actions release and delete. Today no rule places such an item there: `youCase` in `packages/domain/src/rules/delivery-placement.ts` returns an Unblock group for five reasons (`blocked-marker`, `fleet-stuck`, `merge-conflict`, `agent-died`) and none of them is "loose". `packages/board/src/app/lib/agent-rows/delivery-readings.ts:132` already types such a row `pr` or `branch` (`ItemKind`), so the row exists and only its placement and its actions are missing.

Build three things, in this order:

1. A domain rule that decides "loose" from readings as values and places the item under Unblock with a new `YouReason`. Add the reading to `WorkItemReading`; do not compute the decision in `.tsx`.
2. A delete controller, with an HTTP route and a board-free bundle, shaped like `restart`: `packages/board/src/server/restart.ts` (route), `packages/fleet/src/server/entry/restart-command.ts` (bundle entry), and `ControllerAction` in `packages/domain/src/rules/controller-gate.ts:12` (gate and the command it names). Copy that wiring rather than inventing another.
3. The row's buttons, calling the two controllers.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**"Release" already has a controller. Do not build a second one.** `POST /api/release-claim` and `plot-ask.mjs release-claim` run `gatherReadingsAndRelease` (`packages/fleet/src/shared/release-claim-reader.ts`), which asks the domain's `releaseClaim` and then `plot-dispatch.sh --release`. The plan says "a missing controller is part of this work"; for release that sentence is out of date, and only delete is missing. The button calls the existing route.

**`/api/release` is a different act and the wrong one.** It cuts a versioned release through `plot-deliver.sh --release`. The plan's "Release" for a loose end means giving up a claim and deleting the ref (Settled Questions). `release-claim.ts` says the same in its header. Name the new action so no reader confuses the three: not `release`.

**Delete refuses, and a refusal ends the action.** The controller refuses a branch with an open PR, and a branch with an unpushed commit. Before it deletes the remote ref it pins the tip at `refs/plot/reaped/<branch>/<sha>`, the way `plot-reap.sh` does for a local branch (CLAUDE.md, "One Answer To Did This Land"). Pin first, delete second: a branch deleted wrongly stays recoverable by name. Reuse the port and adapter that `reap` uses for the pin; a new `spawn`/`execFile` outside `packages/domain/src/adapters/` fails the ratchet at `ci.yml` (`allowed=28`).

**The host answers "did it land", never ancestry.** A loose branch whose PR merged is not loose, it is a merged branch that `plot-release-refs.sh` owns. Read `mergedAt` through the host port. Squash-merge leaves a landed branch ahead of main for good, so `git merge-base --is-ancestor` is the wrong question here (`scripts/check-ancestry-decisions.sh` refuses an undeclared call).

**"Nobody works on it" is a measurement.** A branch with a live desk or a registry manifest holds a claim and is not loose. A PR with `inFlight` set in `.plot/state/fixer-attempts/<pr>.json` has a fleetd fixer on it now and is not loose. An item a plan names is not loose, whatever its state. Absent is not false: a reading nobody took makes the item unplaced (`Unplaced.reason: 'unread'`), never loose.

**The delete controller runs over HTTP and with no board**, as `plot-restart-command.mjs` does (Settled Questions). A board-free action that carries no receipt is invisible to the controller gate, so wire the gate's refusal text and its `--unowned-action` path the way `restart` does, and extend `packages/domain/test/controller-gate.test.ts` and `test/reconcile/controller-gate.test.mjs` for the new action.

### Open points to report, not to improvise

- **A loose PR has no working action.** `plot-dispatch.sh --release` refuses any branch that has a PR (open or merged), and the delete controller refuses an open PR. So the two actions the plan names fit a loose BRANCH only. For a loose PR the plan's third action, "plan it", is the one that applies. Ship the buttons each kind can use, say so in the PR body, and do not add a close-PR action: no plan licenses it.
- **"Plan it" is named in the Approach and absent from the changelog and the slice line.** An `idea` route exists. Link the button to it if its inputs fit; if they do not, leave it out and report it.
- **The plan has no `## Done when`.** The assertions below stand in for it.

### Done when

- A unit test on the domain rule for each case: a branch with no plan, no desk and no PR is loose; the same branch with a live desk is not; with a manifest is not; with an open PR it is a loose PR; a PR with an `inFlight` fixer is not; a branch a plan names is not; an unread reading is unplaced. The case "a plan names it" is the one a naive rule passes without.
- A unit test that a loose item lands under **You › Unblock** with the new reason, and that the Mine filter treats it as it treats other Unblock items.
- Delete controller tests: refuses an open PR; refuses an unpushed commit; refuses when the host cannot be asked (silence is not permission); pins `refs/plot/reaped/<branch>/<sha>` before the delete, asserted by call order, not by presence; deletes nothing on any refusal. Make the arms disagree in the fixture, or a mutation passes (memory: mutation fixtures).
- One browser test proving the row shows its actions. Behaviour is decided in the domain; the browser test proves it is seen.
- A `controller-gate` test naming the new action.

Plus: add a changeset (`'plot': minor`, description first and the `bumps:` block last, `plan:` line inside the block); add a row to `skills/plot/scripts/README.md` for any new script and keep `scripts/check-helper-table.sh` green; add the new bundle where `restart-command` is registered in `packages/board/build.mjs`, `packages/fleet/build.mjs` and `packages/board/src/contract/bundles.generated.ts`; amend the controller list in CLAUDE.md ("The Master Agent Uses The Controllers") and run `./scripts/check-agents-md.sh --write`. Never commit a rebuilt `board-server.mjs` or any generated bundle: `scripts/check-no-bundle-diff.sh` refuses it. Run `pnpm build:board` only to test.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run `test:board` while the operator's board is open.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should add no shell: write the rule in the domain and call it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Arrow functions for every function you write; terms are Slice, Agent and Worker as `DESIGN-slice.md` and `DESIGN-agent.md` define them.

### Scope guard

This branch owns: `packages/domain/src/rules/delivery-placement.ts` and its tests, the new rule and controller under `packages/domain` and `packages/fleet`, the delete route under `packages/board/src/server/`, the row actions in `packages/board/src/app/lib/agent-rows/` and the Delivery tab components, `controller-gate.ts` and its tests, CLAUDE.md's controller list, and one changeset.

Do not touch `plot-dispatch.sh`, `plot-reap.sh` or `release-claim-reader.ts`: they are the existing controllers' internals, and this slice calls them. The three sibling slices edit the Delivery tab's rows and the release line; expect a textual conflict in `delivery-placement.ts` and in the row components, and resolve it by keeping both sides. A sibling that changes `WorkItemReading` first means you rebase onto it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
