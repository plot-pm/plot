## Implementation brief — supervisor-tick-s-fleet-scan-reads (wave 3: Per-loop counters)

- **Plan (canonical):** docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2817 merged
- **Branch:** `bug/the-tick-line-counts-each-loop` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (plan `Review: pr`)

Slices 1 and 2 (`bug/a-refused-scan-listing-backs-off` → #2847, `bug/the-scan-listing-honours-the-limit` → #2864) are already merged to `main` — `listingBackoff` and `listingSpend` already live in `@plot-pm/domain` and are already imported in `packages/fleet/src/shared/fleet-scan.ts`. This slice does not touch their logic; it only adds counters alongside the reads they already make. Slice 4 (`bug/a-bitbucket-scan-reads-a-delta`) has not started and is independent of this one.

### What to build

Issue #2815 found that one fleetd ran at 4,500 req/hr against Bitbucket's ~1,000/hr limit while its tick line read `account=3664/hr mine=60/hr` — a figure that looked calm next to a burning account. The plan's cause 6 names why: `mine=` (`registryd.ts:591`, built by `spendForTick` in `registryd-main.ts:455-462`) is `boardSharePerHour(intervalMs, calls)` over the **tick's own** `HostTally` only (`registryd-main.ts:419-421`). The scan runs on the independent 5 s fleet clock (`REFRESH_MS`, `fleet-scan.ts:20`), and the PR reader and issue reader run on their own cadences off that same clock (`fleet-clock.ts:33`, `issue-refresh.ts`) — none of their host reads ever reach the tick's tally. A fleetd whose scan alone is making hundreds of requests an hour still reports `mine=60/hr`, because that number only ever measured the tick.

Build per-loop request counters, one per fleetd loop — the tick, the scan, the PR reader, the issue reader — each counting its own host reads in-process, and change the tick line to print one requests/hour figure per loop instead of the single `mine=`.

### Decisions the plan settles — do not re-derive them

**No `budget.tsv` schema change.** The plan's decision list is explicit: "It does not attribute `budget.tsv` lines, which carry no caller by design" — the Rejected plan `2026-09-29-a-spend-line-names-its-caller` already proposed and rejected a caller column there. This slice is a pure in-process counting exercise; it reads nothing new from disk and writes nothing new to `budget.tsv`. If per-loop attribution feels like it wants a persisted field, that question is already closed — do not reopen it here.

**The scan's own count comes from two sources, not one.** `scanOnce`'s own host reads (through its `ScanWorld` ports) are countable in-process the same way `HostTally` counts the tick's. But the scan also shells out to `plot-fleet-scan.sh`, which makes its own `plot-host.sh` calls the TypeScript side never sees directly. The plan's answer: add **one tagged stderr line from the shell** reporting the requests the shell itself spent, read the same way `fleet-scan.ts:601` already reads the shell's `listing:` lines (`if (line.startsWith('listing:')) ...`). Follow that existing pattern — a new prefix (e.g. a `spend:` line), parsed the same way, folded into the scan's own in-process count rather than replacing it. The shell side of this line counts honestly only if it is derived from the same host-call sites `pr_list_verdict`/`host_pr_state` already go through — do not add a second, independently-maintained tally in the shell that can drift from what it actually calls.

**The per-hour arithmetic is a domain rule, not a one-off computation in the fleet package.** `boardSharePerHour(intervalMs, costPerRefresh)` already exists in `packages/domain/src/rules/cadence.ts:72` and is exactly "count × (HOUR_MS / interval)". Reuse it per loop over each loop's own interval (`REFRESH_MS` for the scan, `PR_REFRESH_MS` for the PR reader, `ISSUE_REFRESH_MS` for the issue reader, the tick's own 60 s for the tick) rather than writing a parallel formula. The plan explicitly calls this out as "a domain per-hour rule beside `boardSharePerHour`" — meaning it may need a small adjacent rule (e.g. one that takes a named set of loop counts and intervals and returns a set of per-hour figures for the tick line to print), not a reimplementation of the interval-to-rate math itself.

**Where the counters live.** Each loop already has (or needs) its own tally, in the same shape `HostTally` already gives the tick (`registryd-main.ts:419-421`, incremented at each host call site, read once, then zeroed — not at the top of the loop, for the same ordering reason the comment there gives: a reset-at-top can wipe calls a later step in the same pass made before the read sees them). Give the scan, the PR reader, and the issue reader each their own analogous tally rather than reusing or sharing `HostTally` across loops — they run on independent cadences and must not contaminate each other's counts.

### Done when

The plan's `## Done Conditions` names slice 3's bar directly: *"the tick line's per-loop figures equal the fake host's request counts per loop, and their sum equals the `budget.tsv` line count over the same hour."* That is the test to write: drive a fake clock through a simulated hour (720 beats of 5 s, matching the harness the other three slices' done conditions already use), have each loop make a known, distinguishable number of fake host calls, and assert:
- each printed per-loop figure matches that loop's own known call count scaled to per-hour by its own interval
- the four figures' sum equals the total `budget.tsv` line count written during the same simulated hour (private `PLOT_BUDGET_HOME`, per the plan's `## Done Conditions` preamble)

This second assertion is the one a naive per-loop counter can fail silently: if the shell's `spend:` stderr line double-counts (reports the shell's calls AND the TypeScript side separately counts the same calls through a different path), the sum overshoots `budget.tsv`'s own line count. If the shell line is missing or the scan only counts its own in-process ports, the sum undershoots. Either direction should fail the test, not just produce a plausible-looking number.

Plus: the repo's gates. Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the tests that name a changed file, the related tests and typecheck of `packages/domain` and `packages/fleet`, and the gate tests and `scripts/check-*.sh`. The suites in `CLAUDE.md`'s `CI suites` key run in CI on every PR; do not run them locally as a matter of course (see `CLAUDE.md` § Testing — `test:e2e` is CI's gate, not a local one).

`scripts/check-shell-lines.sh` ratchets the shipped shell's line count against the merge base: adding the `spend:` stderr-reporting line to `plot-fleet-scan.sh` (or wherever it lands) costs lines, and the gate demands they be paid for by removing an equal number elsewhere in the same change, or by writing the counting rule in the domain and reaching it through a bundle instead. Budget for this before writing the shell side.

### Bookkeeping

Open the PR through the controller once the branch carries a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Never `gh pr create` directly (see CLAUDE.md § The Master Agent Uses The Controllers). Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section under "Per-loop counters", and set its board status to "Ready" if a project board is configured (none is, per this plan's config — skip).

### Scope guard

This branch owns:
- `packages/fleet/src/shared/fleet-scan.ts`, `fleet-clock.ts`, `issue-refresh.ts` — adding per-loop tallies
- `packages/fleet/src/server/entry/registryd-main.ts`, `registryd.ts` — the tick line's print format (`tickLine`, `spendForTick`)
- `packages/domain/src/rules/cadence.ts` (or a new adjacent rule file) — the per-loop-set-to-per-hour-figures domain rule
- `skills/plot/scripts/plot-fleet-scan.sh` — the new tagged stderr line reporting the shell's own spend

Other branches in flight on this plan: slice 4 (`bug/a-bitbucket-scan-reads-a-delta`, not yet started) will also touch `fleet-scan.ts` and `plot-fleet-scan.sh` (the Bitbucket delta fold and its own `NOTICE_PATTERNS`/stderr line). Expect a rebase against slice 4's changes if it merges first, or vice versa — check `git log` on `fleet-scan.ts` before opening the PR to see which landed first. Slices 1 and 2 already merged are not in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular the plan's own Open Questions (carried-listing max age, two-fleetd-one-account composition) are explicitly out of scope for this slice.
