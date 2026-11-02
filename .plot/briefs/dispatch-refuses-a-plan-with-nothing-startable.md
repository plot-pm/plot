## Implementation brief — a-slice-held-by-an-open (wave 1: Held start refusal)

- **Plan (canonical):** docs/plans/2026-11-02-a-slice-held-by-an-open.md on main
- **Approved:** 2026-11-02, Jan Wloka, plan-PR #3050 merged
- **Branch:** `feature/dispatch-refuses-a-plan-with-nothing-startable` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`, `plot/review` status)

This is wave 1 of 2. Wave 2, `feature/a-held-slice-reads-as-waiting`, reads the `sliceHold` function this branch adds, so this branch must merge first. No `waits:` annotation is needed; the wave order carries it.

### What to build

A manual dispatch of a plan whose only unsettled branch is held by an open `waits:` annotation starts a brief run that cannot succeed. Measured 2026-11-02: `plot-dispatch-command.mjs every-plan-reference-shows-its-issue` started the brief writer three times; two runs ended at `IMPLEMENT_TIMEOUT_MS` (5 min) with exit 124. The cause: `briefBranchFromPulse` (`packages/domain/src/rules/auto-dispatch.ts`, `startableBranches(...)[0] ?? null`) returns `null` both for "no pulse" and for "nothing startable", and `startImplement` runs a branchless brief on `null`.

Build, in the domain and its two controllers:

1. `startabilityVerdict` (`packages/domain/src/rules/verdict.ts`) returns `null` for `state` `waiting` or `blocked`, before the slice-verdict test (`verdict !== 'eligible'`). Keep the existing `draft` → `waiting-on-approval` line ahead of it. `StartabilityVerdictSchema` does not change. `unknown` keeps today's answer.
2. `sliceHold(verdict, branches)` in `verdict.ts`. Input: the slice verdict and, per branch, its `state` and `startability`. Output: `null` or `{ blocked: boolean, held: string[] }`. Held when: verdict is `eligible`; at least one unsettled branch (not `merged`, not `deferred`) is `waiting` or `blocked`; and no unsettled branch has a non-null startability. `blocked` is true when any held branch is `blocked`. It reads `startabilityVerdict` and adds only the hold; it is not a sixth spelling of "startable".
3. `dispatchReading(pulse, slug)` in `auto-dispatch.ts`, beside `startableBranches`. It answers `no-reading` (pulse `null`, plan absent from the pulse, or a phase `dispatchPhase` rejects), `branch` (carries the first `startableBranches` name, as today), `held` (no branch startable, at least one slice `eligible`, `sliceHold` holds for every eligible slice, startability computed with `startabilityVerdict(state, phase, verdict, 'unknown')`; carries each held branch with its `state` and `waits_on`) or `no-branch` (anything else: keeps today's branchless run).
4. `DispatchInput.briefBranch` (`packages/fleet/src/shared/dispatch-command.ts:64`) becomes `startReading: (slug) => DispatchReading`. `startDispatch` refuses `held` with `{ kind: 'refused', status: 409, reason: 'nothing-startable' }` before `startImplement`, with no `scripts.start` call and no receipt. The detail names each held branch and its prerequisites with the `classify` sentences (`fleet.ts:4772-4794`: `waits for X`, or `waits for X, which has no pull request`). Update the caller in `packages/fleet/src/server/entry/dispatch-command.ts` (`:75-76`, `:115`) and `POST /api/dispatch` (`packages/board/src/server/dispatch.ts:348`).
5. `POST /api/implement` (`packages/board/src/server/implement.ts:255`) reads the same `dispatchReading` and refuses `held` with the same reason and a 409.

### Settled decisions — do not re-derive them

- **Read the branch `state`, never the pulse field `held`.** `held` is a boolean for a local worktree lock (`entities/fleet.ts:337`); the Fleet index fixture reads `"held":false` with `"state":"waiting"`. A test pins that an `open` branch with `held: true` and no wait answers `branch`, never `held`.
- **Refuse on positive evidence only.** `null` also means "no pulse": the bridge older than 15 min reads `null` (`fleet-state-file.ts:17,80`). A stale or missing reading must keep starting as today, so `no-reading` and `no-branch` are separate kinds and only `held` refuses. Collapsing them would block every dispatch on a cold board.
- **No new `SliceVerdictSchema` member.** A new member (`entities/fleet.ts:102`) makes every older bundle reject the whole pulse and breaks `corpus/eligible.corpus.test.ts`. The consumer derives the hold. No pulse, `/api/fleet` or scan change, and do not edit `plan-walk-assembly.ts` (PR #3048 moves it).
- **One domain function for both controllers**, so they cannot disagree. Case table: `open` + `waiting` is not held (`branch`, dispatch offered); `claimed` + `waiting` is not held; `merged`/`deferred` + `waiting` is held; `waiting` + `blocked` is held with `blocked` true; all `merged` or all `deferred` is not held; verdicts other than `eligible` are not held.
- Domain style: arrow functions, TSDoc states behaviour only (no history). Say `Slice`, not `Wave`, in new code. The domain stays pure (zod only outside `adapters/`). Rules carried over: absent is not false; the index and pulse never say "no".

### Done when

The plan's `## Done when` / test table rows for this wave are the specification: the `startabilityVerdict`, `sliceHold` and `dispatchReading` rows in `packages/domain/test/verdict.test.ts` and `auto-dispatch.test.ts`; the `startDispatch` rows in `packages/fleet/test/unit/dispatch-command.test.ts`; the two rows in `packages/board/test/unit/dispatch-brief-branch.test.ts`. Assertions that exist because a naive implementation passes without them:

- The `held: true` desk-lock case answers `branch`: catches a rule that reads the wrong field.
- `no-reading` and `no-branch` still start, and the existing `pulse: () => null` entry tests (`dispatch-command.test.ts:73`, `:84`, `:94`) keep their outcomes: catch a refusal on missing evidence. Change the input at `:227` to `startReading: () => ({ kind: 'no-reading' })`.
- The `held` refusal asserts no `startImplement`, no `scripts.start` and no receipt: catches a refusal that still spawns.
- One fixture fed to `dispatchReading` and `sliceHold` agrees on held or not held.
- Copy the Fleet index row from `.plot/state/last-pulse.json` (2026-11-02) into the fixture; PR #3048 merging removes the live case.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. Add a changeset (`plot` package, description first, `bumps:` block last) and run `./scripts/check-changeset-packages.sh`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Do not commit a rebuilt board artifact.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/verdict.ts`, `packages/domain/src/rules/auto-dispatch.ts`, `packages/fleet/src/shared/dispatch-command.ts`, `packages/fleet/src/server/entry/dispatch-command.ts`, `packages/board/src/server/dispatch.ts`, `packages/board/src/server/implement.ts`, their tests, and one changeset.

It does not touch: `packages/board/src/app/**` (wave 2, `feature/a-held-slice-reads-as-waiting`), `rows.tsx`, `tuple-row.ts`, `row-identity.ts`, the scan, `plan-walk-assembly.ts`, or the pulse schema. Out of scope for both waves: `nextWork`, `firstBrieflessBranch`, `skippedPlans` and the fleet log lines (see plan Notes). Report anything else the plan did not anticipate rather than improvising.
