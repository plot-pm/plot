## Implementation brief — triggers-replace-the-tick (wave 4: Tick waits)

- **Plan (canonical):** `docs/plans/2026-11-10-triggers-replace-the-tick.md` on `sprint/triggers-and-connectors`
- **Approved:** 2026-11-11, jwloka, plan-PR #3387 merged
- **Branch:** `feature/triggers-replace-the-tick-tick` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to `sprint/triggers-and-connectors`
- **Review of the code:** per repo convention (PR review, `plot/review` status)

This is the last slice. Waves 1–3 (`fleet-size` #3399, `deadlines` #3395, `watches` #3396, `safety-net` #3400, `quiet-beats` #3404, `scan` #3419) are merged, so nothing waits on this branch except the plan's delivery.

### What to build

The supervision tick still sleeps on `sleep(args.intervalMs)` (`registryd-main.ts`, the `pause` at about line 3405), so an idle fleetd starts the tick's `pr-merged`, desk `status` and `madeProgress` reads every 60 s. Census row S4 measured 516 direct `execve` per pass on the GitHub fixture with 0 desks and 839 with 3 desks at the sprint head; the target is 0. Change the wait so the loop wakes on the first of: a scan that drained a non-empty pending set, a `registry`, `desk-files` or `worker-gone` change, and `nextDeadline` (already built and logged on the tick line by wave 1). The tick's own reads then run only on a tick a trigger started. `--interval` becomes the tick's cadence only while a watch is degraded (Open Question 3, decided).

Also: the census pass (`packages/fleet/test/census/fleetd-census-entry.ts`, `pass`) ends on `reportTick`'s log line today. Change it to advance the manual clock by 120 s and end when no direct child has run for `QUIET_MS` (300 ms; the entry already holds a `QUIET_MS` and an in-flight counter at about line 258). S5 and S6 keep their windows. S4 turns green on the GitHub fixtures: add the slice name and `green: true` to its row in `census-rows.ts`. The Bitbucket fixture stays `it.fails`, naming `bitbucket-and-jira-read-in-process` (Open Question 2, decided). Record the measured S4, S5 and S6 figures in the PR and in the story's Measures table (`docs/stories/nothing-changed-nothing-runs/`); the plan states no number before this slice measures one.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **The tick does not poll at a lower rate.** An upper-bound `--interval` (Open Question 3, option c) would run an idle tick every 60 s, and S4 counts that. Settled: `--interval` applies only while a watch is degraded.
- **The drain waits for the beat, not the event** (Open Question 6): latency stays 5 s, the scan keeps its in-flight guard and 90 s budget, and a rebase's burst of refs events costs one scan.
- **No watch on plan, sprint or story directories** (Open Question 1): a refs change names `plans`; fleetd reads no plan from the checkout.
- **A deadline names no readings**: the rule that owns it runs over the readings already held. The timer wakes the tick; it does not widen what the scan reads.
- **Destructive actions re-ask their evidence immediately before they act.** A trigger that starts the tick is not evidence. The re-ask tests of `plot-ask.mjs merge`, worktree removal and claim release must pass unchanged.
- **`clockDrift` reads both clocks through the `Clock` port.** Do not read `Date.now()` and `performance.now()` directly in the wait: the census entry moves `Date.now()` by 120 s per pass while the monotonic clock moves about one second, and a direct read sees a jump on every pass, so S4 can never reach 0. `clockManual` moves both readings together.
- **Absent is not false.** A missing or unreadable reading means "read it", never "nothing changed".

### Done when

The plan's `## Done when` rows for *Tick waits* are the specification:

- census S4 reads 0 on the GitHub fixtures, and the row carries `green: true` and the slice name;
- on `clockManual`, a slice past `Slice idle after` produces its finding on the timer with no trigger;
- the re-ask tests named above pass unchanged;
- a fleetd start runs one full read and re-derives every desk's finding.

Assertions a naive implementation passes without: (1) the idle-wait test must hold the pending set empty and the watches armed, or a degraded watch would hide a missed wait behind the `--interval` cadence; (2) the timer test must advance no event, or a trigger would fire the finding and the deadline path would go untested; (3) the start test must cover a fleetd start with desks already present, because a start that reads nothing until the first trigger leaves them unjudged.

Plus: a changeset (description first, `bumps:` block last), and the board artifact is not committed (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: if the slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through a bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `### Wave 4` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the wait in `packages/fleet/src/server/entry/registryd-main.ts` and `registryd.ts`, the fleet clock's drain signal in `packages/fleet/src/shared/fleet-clock.ts` if the tick needs one, `packages/fleet/test/census/fleetd-census-entry.ts` and `census-rows.ts`, `docs/process-census.md`, and the story's Measures table. No other Phase 8 slice is in flight. Phase 7 plans share `registryd-main.ts`; read `git log origin/sprint/triggers-and-connectors` for their merges before editing. If you find something the plan did not anticipate, report it rather than improvising outside scope.
