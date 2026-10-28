## Implementation brief — no-controller-restarts-a-stopped-slice (wave 2: A fleet start restarts what its stop stopped)

- **Plan (canonical):** `docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2788 merged
- **Branch:** `bug/a-fleet-start-restarts-what-its-stop-stopped` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 of 2, and it lands after wave 1. Wave 1 (`bug/a-stopped-slice-has-a-restart-controller`, → #2799) is merged: the `restart` controller exists — `restartWorker` in the domain, `continueOnDesk`'s restart precondition, `POST /api/restart`, `plot-restart-command.mjs <branch>`, and the Restart row state. This wave is the only thing still open on the plan.

### What to build

Issue #2784. On 2026-10-27, `plot-fleetctl.sh --stop` sent SIGTERM to the worker of `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (exit 143), then `--start 8` started 7 free desks and did not restart that one. The slice sat parked — `worker: failed`, `startability: someone-is-on-it` — for about 90 minutes until a person acted, because `--start` keeps no record of which slices `--stop` stopped.

Build that record and the restart it drives:

1. `plot-fleetctl.sh --stop` keeps writing the `stopped` ending exactly as it does today (`ending-action.ts:149` still answers `leave` for it — do not touch that). Add: it also records the list of branches it stopped this run.
2. `plot-fleetctl.sh --start` reads that list and restarts exactly those branches, each through wave 1's `restart` controller (`plot-restart-command.mjs <branch>`, or the bundle call it wraps) — so every wave-1 refusal (`reached-review`, `pr-unanswerable`, `loop-alive`, `worker-alive`, `blocked-marker`, `unattended`) applies unchanged to a fleet-level restart.
3. The domain decides which listed branches are restarted; `plot-fleetctl.sh` holds no restart logic of its own and calls the bundle. `plot-fleetctl.sh` is not itself a controller-owned action script the way `plot-dispatch.sh` is, but the decision of *which stopped branches qualify* belongs in `packages/domain`, not in shell conditionals.
4. A branch a person stopped directly with `plot-dispatch.sh --stop` (bypassing `plot-fleetctl.sh --stop`) is never on the fleet's stopped-branches list and must stay stopped after `--start`. That is the whole point of recording the list rather than inferring "restart everything that reads `failed`/`stalled`/`ended`/`none`".

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**fleetd never restarts a stopped slice by itself.** Decided explicitly in panel round 1: `stopped` answers `leave` deliberately, and that stays true. This wave's `--start` restart is scoped to the exact list `--stop` recorded in the *same* fleet-level operation — it is not a standing "always restart anything dead" policy, and it must not become one. A slice nobody's `--stop` touched is untouched by `--start`, however dead its worker reads.

**One rule, not shell logic duplicating the domain.** `scripts/check-shell-lines.sh` grants no exemption for this slice — it must add zero net shell lines (the plan's own `Done when`: "no more [lines] on slice 2"). If the stopped-branches bookkeeping or the restart-eligibility decision needs real logic beyond "read a list, loop, call the bundle", write it in `packages/domain` and reach it through a bundle, per *A Shell Script Asks The Domain* in `CLAUDE.md`. Do not grow `plot-fleetctl.sh` to pay for this feature; if the loop over the list needs more than a trivial read, that is the `--per-agent-per-pass` case covered by the shell-shrinks-into-the-domain rule, not a free pass.

**Each restart goes through the wave-1 controller, never a direct call to what it wraps.** *The Master Agent Uses The Controllers* applies here with no exception for a fleet-wide operation: looping over branches and calling `plot-dispatch.sh --restart` directly, or hand-rolling the refusal logic again, is the duplicate wave 1 exists to remove. Call `plot-restart-command.mjs <branch>` (or the bundle function it calls) per branch.

**Where to persist the stopped-branches list is yours to decide, but it must survive between the `--stop` process exiting and the next `--start` invocation** — these are two separate shell invocations, possibly minutes or hours apart, so it cannot live in a shell variable. Look at how other fleet-level state is persisted on disk under `.plot/state/` for the existing convention (the PR index, the default-branch reading, and the issue index are examples of fleet-written JSON state files) before inventing a new mechanism.

**Refusals surface, they don't abort the batch.** A `--start` that restarts five branches and finds one refused (say, `reached-review` because a person opened a PR on it since the stop) should report that branch's refusal by name and continue restarting the others — consistent with how `plot-fleetctl.sh --stop` itself reports a per-branch outcome and carries on (see the `still`/`n_still` handling in its own `--stop` loop) rather than treating one failure as fatal to the whole run.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist because a naive implementation passes without them:

- The 2026-10-27 reproduction, run in a sandbox fleet: `plot-fleetctl.sh --stop` then `--start` restarts the slice `--stop` stopped, and a *different* slice stopped earlier with a direct `plot-dispatch.sh --stop` (never through `plot-fleetctl.sh --stop`) stays stopped. This is the test that catches "restart everything dead" masquerading as "restart what I stopped" — the two read identically on a single-branch fixture.
- `scripts/check-shell-lines.sh pr` reports no more lines than the merge base. It catches logic that landed in shell instead of the domain.
- Each per-branch restart in the `--start` loop is attributable to a call into the wave-1 controller path, not a reimplementation of `restartWorker`'s refusal order. A fixture where the controller would refuse `loop-alive` must see that exact refusal surfaced by `--start`, not silently skipped or misreported as something else.

Plus: a new bundle or a new `scripts/`-listed helper needs its `skills/plot/scripts/README.md` row (`scripts/check-helper-table.sh`). Add a changeset (description first, `bumps:` block last, with `plan:` naming this plan). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Write new domain and fleet functions as arrows, with TSDoc stating what the export does and returns, not the history of the decision.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the fleet-stop/fleet-start bookkeeping: `plot-fleetctl.sh`'s `--stop`/`--start` arms, whatever new domain function decides restart eligibility from a recorded list, and whatever new state file carries that list between runs. It does not touch `restartWorker`, `continueOnDesk`, `POST /api/restart`, or `plot-restart-command.mjs` — those are wave 1's, already merged and done. If something there looks wrong or incomplete while you're working this wave, report it rather than fixing it in this branch's diff.

As of this writing no other branch in flight touches `plot-fleetctl.sh` or its `--stop`/`--start` arms — verify that's still true with `/plot-pulse` before you start, since several slices from other plans are dispatched concurrently in this repo's fleet right now.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
