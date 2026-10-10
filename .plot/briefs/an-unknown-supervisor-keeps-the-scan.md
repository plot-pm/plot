## Implementation brief — the-fleet-closes-its-review-findings (wave An unknown supervisor keeps the scan)

- **Plan (canonical):** `docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md` on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1499 merged
- **Branch:** `bug/an-unknown-supervisor-keeps-the-scan` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review, `Review: pr`)

First wave. Slices 2, 9, 10, 11 and 12 also touch `plot-fleetctl.sh` and slice
13 also touches `scan-owner.ts`, but none of them can start until this one
merges — the plan runs its slices one heading after another because every
pair that shares a file would otherwise collide, and this heading goes first
because it depends on PR #1500's `unknown` reading already being on main.

### What to build

Two independent fixes, both scoped to this one wave:

**1. `fleetOwnsScan` currently treats `unknown` the same as `down`.**
`packages/domain/src/rules/scan-owner.ts:35` calls `supervisorState(readings.supervisor)`
and returns `false` whenever that is not exactly `'up'` — so an `unknown`
reading (the script could not be asked, or was cut short before its summary
line) takes the scan away from the fleet and hands it to the board, even when
the fleet's bridge is seconds old and proves the daemon is alive and ticking.
Change the gate so an `unknown` reading with a bridge younger than
`OWNED_BRIDGE_MAX_AGE_MS` *also* leaves the scan with the fleet — only a
reading that resolves to `down` (or `died`) should hand the scan to the
board. This answers #1445 L3.

**2. A stuck `lsof` call survives past the run that started it, and nothing stops a second run from piling on more.**
PR #1500 (merged, `1f0df293f`) added a per-run deadline: `process_cwd()`
(`skills/plot/scripts/plot-fleetctl.sh:361-368`) now reads `lsof` through
`read -t "$left"`, bounded by `lsof_until=$((SECONDS + 2))` set once per
`--status` block (`:396`). That bound stops *this script's own call* from
blocking the run past 2 s — proven, and not this slice's job to redo. What it
does **not** do is stop the underlying `lsof -a -p <pid> -d cwd -Fn` process
itself: `read -t` abandons the pipeline, and the measurement in the plan's
Motivation section is explicit that a `SIGALRM`/timeout cannot reclaim a
process already parked in kernel state `U` — one such process was left
running 556 s after a 15 s alarm. So every `--status` call that hits this
condition leaves one more stuck `lsof` behind it, and nothing before this
slice stops a *second* `--status` invocation from starting a *new* `lsof`
against a pid some earlier stuck `lsof` is already watching. 80 such
processes were measured stuck at once on 2026-10-10 (#1503 M1). Add a guard
in `plot-fleetctl.sh` that detects an already-running `lsof -a -p <pid> -d cwd -Fn`
for a pid before starting another one for the same pid, and skips the new
call (reading cwd as cannot-determine, same as the empty-answer case) rather
than adding to the pile. The guard is about *not starting a redundant
process*, not about killing the stuck one — nothing here can un-stick a
process already in `U`.

### The decisions the plan settles — do not re-derive them

**Do not touch `supervisorState` or `plot-fleetctl.sh`'s own interrupted-run
handling.** PR #1500 already made `runProcess` and the awaited report return
`interrupted` for a run stopped at its bound, and made `supervisorState` prefer
the summary's `supervisor=` field, falling back to `unknown` for an
interrupted run that lacks one. That work is merged and out of scope — this
slice only changes `fleetOwnsScan`'s *consumption* of an `unknown` reading,
not how `unknown` is produced.

**`unknown` is not `down`, and conflating them is the whole defect.**
`supervisor-reading.ts`'s own doc comment (`:17-37`) is explicit that `unknown`
exists so a board that could not ask renders neither an alarm nor a clean
bill of health. `fleetOwnsScan`'s current `!== 'up'` check silently treats
"could not ask" the same as "asked and it said no" — that is the bug, not a
missing third branch to design from scratch.

**The bridge-age check is the other half of the guard and stays unchanged.**
`fleetOwnsScan` already requires *both* a qualifying supervisor reading *and*
a bridge younger than `OWNED_BRIDGE_MAX_AGE_MS` (180 000 ms, twice the scan's
90 s budget) before handing the scan to the fleet. Extending which supervisor
readings qualify does not relax the bridge-age half: a fleet that cannot be
asked about *and* has gone quiet for two scans still loses the scan to the
board, which is correct — that combination is indistinguishable from a dead
daemon.

**The `lsof` guard is a dedup, not a kill.** A `timeout`/`SIGALRM` was already
tried against a stuck call and measured to not reclaim it (both the Motivation
section's trace and the Notes' second timed test, which ran 556 s). Do not
reintroduce a kill attempt here; the fix is to not start a second redundant
call, not to end the first one.

### Done when

The plan's `## Done when` list for this slice is: *`fleetOwnsScan` leaves the
scan to the fleet for an `unknown` supervisor reading with a bridge younger
than `OWNED_BRIDGE_MAX_AGE_MS`.* Extend the existing test table in
`packages/domain/test/scan-owner.test.ts` (five `it` blocks today, all
exercising `UP`/`DOWN`/`undefined`/not-asked) with cases that pin the new
behaviour precisely, because a naive fix could overshoot:

- an `unknown` reading (`{ asked: true, exitCode: 1, summarised: false }`, or
  `{ asked: false, exitCode: null, summarised: false }`) with a fresh bridge
  → `true` (the new case this slice adds)
- the same `unknown` reading with a *stale* bridge → still `false` (the
  bridge-age gate must still bind on `unknown`, not just on `up`)
- a `down` reading (exit 1 with `install: 'not-installed'`, or any reading
  `supervisorState` resolves to `'died'`) with a fresh bridge → still `false`
  (only `unknown` gets the new allowance; a reading that resolved cleanly to
  *not running* must still hand the scan to the board)

For the `lsof` guard, add a test in `plot-fleetctl.sh`'s existing test file
(`fleetctl.test.mjs`) that starts a long-running fake `lsof` stand-in for a
pid, then runs `process_cwd`/the status block a second time for the same pid,
and asserts no second `lsof` process was spawned for that pid — the existing
suite already fakes `lsof` for other `--status` cases, follow that pattern
rather than inventing a new fixture shape.

Plus: the repo's gates. Before each push, run
`node skills/plot/scripts/board/plot-local-checks.mjs` (resolved from the repo
root — this skill directory is `skills/plot-implement/`) and run exactly what
it prints: the tests naming a changed file, the related tests and typecheck
of `packages/domain` (this slice touches `packages/domain/src/rules/`), and
the gate tests and `scripts/check-*.sh`. The suites under the `CI suites`
config key run in CI on every PR — do not run them locally as a matter of
course; a failure there comes back as a correction, not a blocker now.

Name the shell gate explicitly because this slice touches `.sh`:
`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew
past its merge-base line count. The `lsof` guard adds lines to
`plot-fleetctl.sh`; pay for them by removing an equal number elsewhere in the
same change, or by writing the dedup logic in the domain and asking it
through a bundle instead of inlining it in shell.

### Bookkeeping

Open the PR through the controller once there is a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # while still in draft
../plot/scripts/plot-open-pr.sh --draft  # or draft explicitly while work moves
```

Do not run `gh pr create` — it has no access to which plan and wave this
branch belongs to and would title the PR from the last commit subject. Once
the PR exists, append `→ #<number>` to this branch's line under the plan's
`## Slices` → `### An unknown supervisor keeps the scan` heading, and push the
first real commit as soon as it exists so the branch is visible rather than
silent.

### Scope guard

This branch owns `packages/domain/src/rules/scan-owner.ts`,
`packages/domain/test/scan-owner.test.ts`, and the `process_cwd`/status-block
area of `skills/plot/scripts/plot-fleetctl.sh` plus its test file
`fleetctl.test.mjs`. Touch nothing else — in particular, leave
`supervisor-reading.ts` and its test alone; PR #1500 already settled that
file and no finding in this plan reopens it.

Other branches from this same plan will later touch `plot-fleetctl.sh` again
(slices 2, 9, 10, 11, 12, each its own heading) and `scan-owner.ts` again
(slice 13) — but none of them run until this slice has merged, so there is no
live collision to track right now, only the ordering: this slice must land
before any of those branches are created.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
