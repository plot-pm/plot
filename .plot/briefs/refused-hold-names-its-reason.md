## Implementation brief — fleetd-tick-stop-and-escalation-defects (wave Implementation)

- **Plan (canonical):** docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/refused-hold-names-its-reason` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — plot-review gate on main

This is the last of the plan's six branches. The other five are started; four
(#1995, #1996, #1997, #1998) are merged and one (`bug/fleetd-unit-harness-findings`,
#2016) is open. No wave ordering applies — this branch does not wait on the others
— but it is the one branch in this plan that also touches `packages/board` and
`packages/domain`, not only `packages/fleet`, so read Scope guard below before
assuming the other five are finished with every file this one might touch.

### What to build

Closes #1642. The supervisor's tick currently names a `refused` hold by branch
only — no agent, no reason, no timestamp — and nothing else in `fleetd.log`,
`fleetd.err` or `.plot/state/` carries the reason either. An operator sees
`held on refused (1): feature/x` and cannot tell what to repair; the only way
to learn the cause today is to read the dead agent's own session transcript,
if it still exists.

The plan's own open question on this issue is already decided (recorded in
plan `## Open Questions`, 2026-10-17 by Jan Wloka): **the refusal record
derives from the tick each time and is never persisted.** So this slice reads
and renders an existing record on each tick; it does not add a new stored
file, and it does not change `RefusedSliceRecord`'s own on-disk shape
(`.plot/state/refused-slices.tsv` stays a bare branch-per-line set — see
below for why this is still enough).

### The decisions this brief settles — do not re-derive them

**The branch-only set already in `.plot/state/refused-slices.tsv` does not
need a reason column added to it, because the reason does not live there
today and adding one would not be "deriving from the tick."** Read
`packages/domain/src/ports/refused-slices.ts`: `RefusedSliceRecord.has(branch)`
answers only a boolean, and `record(branch)` appends only the branch —
deliberately, per its own doc comment ("A SET, NOT A LOG"). Trace where
`record()` is actually called: `packages/fleet/src/server/entry/loop-writes.ts:193`,
inside a branch that also captures `write.refusedAssignment` as an optional
field (line 204) for a *different* write (the ending record, not the refused-
slices TSV). **The reason text an agent gives when it refuses a hand-over
already exists at ending time** — `packages/domain/src/entities/ending.ts:220`
(`refusedAssignment: z.string().default('')`) and
`packages/domain/src/rules/ending-action.ts:222-223`'s `takeUpRefused` — but
today `refusedAssignment` carries only the branch name itself as a presence
flag (`refusedAssignment !== '' && refusedAssignment !== branch`), never the
agent's actual refusal text. That is the gap: the refusal TEXT is available
at the moment an agent ends (same place `PLOT-CORRECTION.md`-style detail
text already flows, per `registryd.ts:852`/`:1261`'s `refusedAssignment:
endingReading.read === 'ended' ? endingReading.ending.refusedAssignment :
''`), and it is discarded before it reaches `refusedSlices.record()`, which
takes only a branch.

**Where the reason needs to land, and why the TSV is still the wrong place
for it:** widening `refused-slices.tsv` to a `branch\treason\twho\twhen` row
would make the "SET, NOT A LOG" file start aging — a later refusal of the
same branch would need to overwrite the row rather than no-op like `record()`
does today, and nothing currently reads this file for anything but
`has(branch): boolean` (`registryd-main.ts:881`). The plan's decision —
derive from the tick, never persist — means the reason belongs in the
**ending record** that already exists per-desk (`.plot-worker.ending.json`,
read via `endingReading` in `registryd.ts`) and is read fresh every tick the
hand-over world is built (`handOverWorldForRepo`, same file). `refused: async
(branch) => { const answer = await refusedSlices.has(branch); return
answer.ok && answer.value; }` (`registryd-main.ts:878-882`) would become the
read site for a *richer* answer — not just `boolean`, but the ending record's
own `refusedAssignment`/`detail`/`at` fields, already in memory for any
worktree still on disk. Where the worktree is gone (reaped), there is no
richer answer to give — the hold still fires from the TSV boolean, just
without a reason, which is a strictly better fallback than failing closed.

**`QueueHold` stays a plain string enum — the reason is NOT encoded into the
hold value itself.** `packages/domain/src/rules/queue.ts:332-373` lists
`'refused'` alongside `'waits'`, `'assigned'`, etc. as one of ~10 literal
hold names; `whyNotReady` (same file, ~line 497) returns the bare literal.
The precedent for "a hold that carries payload beyond its name" is `'waits'`:
`QueuedSlice` carries `waitsOn: readonly string[]` and `waitHeld` as sibling
fields next to the `hold` discriminant, not inside it (grep `waitsOn` in
`queue.ts`). Follow that shape: add sibling fields to the slice/hold data the
refused reason travels on (agent/session, reason text, timestamp), not a
new union member or a string-encoded hold name. This keeps `QUEUE_HOLDS`
(the fixed array `reportTick` iterates, `registryd-main.ts`) unchanged.

**The tick's print path has the exact seam already, and it is one `else if`
away.** `reportTick` in `registryd-main.ts` (~line 2572-2584) loops
`QUEUE_HOLDS` and branches the per-slice line format on `hold`:
```
hold === 'waits'
  ? `    ${slice.branch} — waits on ${slice.waitsOn.join(', ')} (${slice.waitHeld})\n`
  : hold === 'assigned'
    ? `    ${slice.branch}: assigned to ${slice.assignedTo}\n`
    : `    ${slice.branch}\n`
```
`refused` currently falls into the bare `${slice.branch}` branch. Add a third
arm reading the new sibling field(s), in the same form the issue asks for:
*"the tick names the reason beside the branch, as the `waits` hold does."*

**The board and `/plot-fleet --status` are downstream of the same tick
report, not a second implementation.** Nothing in `packages/board` or
`plot-fleetctl.sh` independently derives a refused-hold reason today — grep
turns up `refused` strings only in unrelated release-claim refusal paths
(`packages/board/src/server/release-claim.ts`, `fleet.ts`'s claim-release
flow), and `plot-fleetctl.sh --status` answers supervisor/agent process
liveness, not slice holds. The plan's own line — "it crosses domain, fleetd
and board" — means: once the domain carries the reason on the held-slice
value and `reportTick` renders it, the board's existing row for a held slice
(wherever it surfaces `hold`/`QueueHold` today — confirm by grepping the
board's queue/pulse-derived rows before assuming a component needs a new
prop) picks up the same richer value through its existing data path. Verify
this at implementation time rather than assuming a new board component is
needed; the plan's own `<!-- Board impact -->` note names `packages/board`
and `packages/domain` as touched, not a new HTTP route.

### Done when

The plan has no explicit `## Done when` section; its Changelog line is the
acceptance bar: *"Board and `/plot-fleet --status`: a refused hold names who
refused it, why, and when."* Add, because a naive fix would pass without
them:

- A test handing a slice to an agent stub that refuses with a specific reason
  string, asserting the tick's printed line for that `refused` hold contains
  that reason — the issue names this test explicitly ("A test should hand a
  slice to an agent stub that refuses with a reason and assert that the tick
  line carries that reason").
- A test for the **absent** case: a slice refused before this change shipped
  (no reason recorded, worktree already reaped) still prints a `refused`
  hold line with no reason rather than throwing or printing `undefined` —
  absent is not false, read what the ending record actually returns.
- A test that `QUEUE_HOLDS`' iteration order and the `held on <hold> (<n>):`
  count line are unchanged for every other hold — this slice adds a rendering
  arm, it must not touch the five other holds' output.
- Whatever test proves the board/`/plot-fleet --status` side picks up the
  same reason — the specific assertion depends on where that render path
  turns out to live; name it once found, don't guess the file now.

Plus: run `node /Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it finds the tests that name your
changed files, the related tests and typecheck for `packages/domain`,
`packages/fleet` and `packages/board` (all three are in scope for this
branch), plus the gate tests and `scripts/check-*.sh`. The suites in the `CI
suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`,
domain coverage, `test/reconcile/*.test.mjs`) run in CI on every PR; do not
run them locally as a matter of course — a failure there comes back as a
correction. `test:e2e` is CI's gate, not a local one (CLAUDE.md, Testing).

If this branch touches any `.sh` file under `skills/`, `scripts/check-shell-lines.sh`
refuses a PR whose shell there is longer than at its merge base — remove an
equal number of lines elsewhere in the same change, or keep the logic in the
domain and reach it through a bundle instead. Expect this branch to touch no
`.sh` file (the mechanism is domain + fleetd + board, all TypeScript); confirm
that remains true before pushing.

### Bookkeeping

Open the PR through the controller once a commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — the controller reads the plan, names the PR after
the wave heading, and carries the plan + this brief in the body. Push the
first real commit as soon as it exists; append `→ #<number>` to this
branch's line in the plan's `## Slices` section once the PR opens.

### Scope guard

**This branch owns:**
- `packages/domain/src/rules/queue.ts` (`whyNotReady`, `QueuedSlice`'s
  sibling fields for the refused hold's reason/who/when)
- `packages/domain/src/ports/refused-slices.ts` and/or
  `packages/domain/src/entities/ending.ts` — only if `refusedAssignment`
  needs to carry the actual refusal text rather than just the branch-as-flag
  it does today; verify the smallest change that gets the reason from the
  ending record to the queue reading before widening either type
- `packages/fleet/src/server/entry/registryd-main.ts` (`reportTick`'s
  `refused` print arm, `handOverWorldForRepo`'s `refused` reading)
- `packages/board/src/...` and/or `skills/plot/scripts/plot-fleetctl.sh`
  `--status` — wherever the held-slice/queue-hold data already surfaces;
  find the existing read site rather than adding a new one

**Sibling branches, all against the same plan but different files — verified
2026-10-18, not guessed:**
- `bug/fleetd-tick-guard-and-escalations` (#1995, merged) — `notifyEscalations`
  tick guard, `EscalationMemory` bound, empty-log tick reading.
- `bug/fleetd-stop-starts-no-agent` (#1996, merged) — stop-during-scan guard,
  `plot-fleetctl.sh` symlink fix.
- `bug/fleetd-retries-usage-limit-brief` (#1997, merged) — usage-limit retry.
- `bug/fleetd-once-and-channel-output` (#1998, merged) — `--once` pipe output,
  channel retry/newline.
- `bug/fleetd-unit-harness-findings` (#2016, open) — #1589 review findings on
  the unit's own test harness.

None of the five touches `queue.ts`, `refused-slices.ts`, `ending.ts`, or
`packages/board` for this reason — but `registryd-main.ts` is a large shared
file every fleetd slice in this plan edits somewhere; diff against current
`main` before editing `reportTick`, since four of the five siblings already
landed changes in that file.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
