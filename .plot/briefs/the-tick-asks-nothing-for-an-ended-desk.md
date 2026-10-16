## Implementation brief — fleetd-scan-cost-and-read-cadence (wave 1: Implementation)

- **Plan (canonical):** `docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Branch:** `bug/the-tick-asks-nothing-for-an-ended-desk` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1374 (tracked by #1845)

The five slices of the wave are independent of each other. This one touches `packages/fleet/src/server/entry/registryd.ts` and `registryd-main.ts`; `bug/the-cold-scan-converges` (#1892) touches `fleet-scan.ts`.

### What to build

The fresh-agent step of the registryd tick asks the host about ended desks without counting the asks. `report.spend` therefore under-reports what the supervisor spends. The issue estimates 600 uncounted `prState` calls per hour for 10 stalled desks.

The plan's line numbers (`registryd.ts:997-1021`, `registryd-main.ts:1758`) are stale on `main`. Verified at `1f3e51ff3`:

- **Ordering is already fixed.** `readFreshAgentCandidates` (`registryd.ts` ~`:840-880`) reads the ending first. It asks `prMerged` only for `endingAsksPersonOutright(ending) || isBoundEnding(ending)`, and `commitBeyondClaim` and `prOpen` only for `isBoundEnding(ending)`, all behind `!endingAsked`. Do not rewrite this gating. Pin it with a test.
- **Spend is still uncounted.** `freshAgentDeskReads` (`registryd-main.ts:1484`) builds `prOpen` from `hostShell(context).prState(branch)`, a host built outside `tally`. `asks.prMerged` goes through `merges.ask`, which does not increment `tally.calls` either; only `worldForRepo`'s `prMerged` (`:502`) and `queuedHasLandedOf` do. `spendForTick(scripts, tally.calls, …)` at `:2242` reads `tally.calls`.
- **The `run()` wiring has no test.** The `args.startAgents && report.incomplete === ''` gate at `:2262` and the `freshAgentPorts` object at `:1999` are inline in `run()`. Extract the port construction into a factory, as the plan says (`freshAgentPorts` is the model), and test the gate through it.

Fix: pass the tick's `tally` into `freshAgentDeskReads` so `prMerged` and `prOpen` each add one call per host question actually asked. Route `prOpen` through the same counted host the tick uses.

### Decisions the plan settles — do not re-derive them

**Ask the host only for candidates whose answer can change the verdict.** `endingAction` already answers `leave` for an ending asked about, whatever the host says. The existing gating in `readFreshAgentCandidates` encodes this. A test that counts calls for an already-asked ending (zero) is the pin.

**Count at the call site, not in `hostShell`.** `HostTally` is the tick's counter; `hostShell` is a connector and knows no tick. A memo must not hide an ask from the count: `merges.ask` answers from the memo on a repeat, so count only where the memo reaches the host, or count per question and say so in the TSDoc. Decide which and state it. The memo is shared with the supervisor world, so a branch the supervisor already asked costs the fresh-agent step nothing.

**Carried-over invariants:**
- **Silence holds.** `'unanswerable'` stays distinct from `'no'`/`'not-merged'` along the whole path (`prMergedReading`, `prOpenReading`).
- **Absent is not false.** An unreadable ending is `unreadable`, not no ending.
- **`merges` memo lifetime is one tick**; `beginTick` clears it. `handOverWorldForRepo` deliberately does not share it.

### Open items the plan lists with this slice

Treat each as in scope only if the measurement shows it: a detached desk falls back to the assigned branch (`worker-loop.ts:770`, `agent-loop.ts:484`), and a released-with-no-claim answer is logged every tick. Verify both still hold on `main` before touching them. If a claim is false, say so in the PR.

### Done when

The plan carries no `## Done when` section for this slice; the specification is the Slices line: *read the ending before the host, count the spend, test the `run()` wiring (#1374)*. Assertions that exist because a naive implementation passes without them:

- **A stub tally across a tick with N ended desks, each asked about once.** Assert `tally.calls` equals the number of host questions the stub received. A fix that adds the counter to `prMerged` and forgets `prOpen` passes a test that checks only one reading.
- **An already-asked ending makes zero host calls and zero tally increments.** Catches a change that moves the counting before the gate.
- **A repeat branch within one tick is counted once when the memo answers it.**
- **The `run()` gate:** with `startAgents` false, or `report.incomplete !== ''`, the factory's ports are never called.
- **A failed `prState` reads `'unanswerable'`, never `'no'`.**

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset (`'plot'` package, description first, `bumps:` last, `plan:` line in the same block). The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply. No board bundle change: do not commit a rebuilt artifact.

New functions are arrows with factual TSDoc.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`; never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/fleet/src/server/entry/registryd.ts`, `registryd-main.ts`, and their tests under `packages/fleet/test/unit/` (`fresh-agent-tick.test.ts`, `registryd-main.test.ts`).

In flight on the same plan: `bug/the-cold-scan-converges` (`fleet-scan.ts`, PR #1892). `bug/the-settled-walk-survives-a-burst` owns `default-branch.ts`; `bug/the-design-commit-key-matches-a-real-plan` owns `auto-design.ts`/`design.ts`/`design-work.ts`; `bug/the-issue-index-writes-at-on-an-answer` owns `issue-refresh.ts`. A change to `registryd-main.ts` near `:2033` (the failed-`backend()` fallback) belongs to the last of these.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
