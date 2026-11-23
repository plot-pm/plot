## Implementation brief — a-continuation-never-resumes-a-role-session (wave 2: Loop)

- **Plan (canonical):** `docs/plans/2026-11-21-a-continuation-never-resumes-a-role-session.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3644 merged
- **Branch:** `bug/a-loop-run-never-uses-a-role-handle` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1, `bug/a-continuation-checks-every-resume-handle`, merged as #3647 (`4cf1983b3`). It left `resumeHandleUsable` (`packages/domain/src/rules/resume-handle.ts`), `transcriptHead` (`packages/fleet/src/shared/transcript.ts`) and the leaf `packages/fleet/src/shared/role-sessions.ts` (`roleSessions`) on `main`. This branch imports all three unchanged and edits none of them. Nothing waits on this branch.

### What to build

The worker loop runs a prompt in whatever session its manifest names, and writes that handle forward. Measured 2026-11-21 on desk `desk-033f539d` (`bug/fleetd-counts-in-the-bb-ledger`): the ending recorded `resumeId` `f5e4b3c3-…`, the unblocker's read-only session (first transcript line `{"type":"agent-setting","agentSetting":"unblocker",…}`). Wave 1 stops a continuation from resuming it. A role handle that already sits in a manifest still reaches the loop, and from there every later ending. Four sites on `origin/main` (line numbers measured 2026-11-22, `worker-loop.ts`):

1. `runPrompt` sets `handle = manifest.resumeId !== '' ? manifest.resumeId : deps.sessionId` at `:1669`, after the hop mint (`:1662-1667`). `spoken` (`:1676`) then sets `PLOT_SESSION_FLAG=--resume` on a role transcript, and the SDK request falls back to `spoken ? handle : ''` (`:1723-1728`).
2. `readPass` passes `manifest.resumeId` as `readings.resumeId` (`:917`). Every `end(...)` in `packages/domain/src/workflows/agent-loop.ts` (`:526`, `:570`, `:865`, `:872`, `:883`, `:893`) hands it to the `loop-end` write, and `loop-writes.ts:218` writes it into `.plot-worker.ending.json`.
3. `end` (`agent-loop.ts:334-362`) spreads `resumeId` whenever it is not `undefined`, so `readings.resumeId: ''` produces `"resumeId":""` in the write. The ending schema reads `''` as absent (`ending.ts:254`), so the write carries a key that means nothing.

Build, in this order:

1. **Port.** Add `resumeHandleReadings(worktree, handle) => { roleSessions, head }` to `WorkerLoopPorts` (`worker-loop.ts:187`) and wire it in `workerLoopPorts` (`:230`) to `roleSessions(worktree)` from `shared/role-sessions.ts` and `transcriptHead(transcriptDir(worktree), handle)` from `shared/transcript.ts`. `roleSessions` answers a `Set<string>`; `transcriptHead` answers `null` where no transcript exists.
2. **`runPrompt`.** After the hop mint and before `handle` is computed, ask `resumeHandleUsable` about `manifest.resumeId` with `branch: manifest.branch`. Where it rejects, mint a handle with `deps.mintHandle ?? randomUUID` (lower-cased, as the hop mint does), write it to the manifest, set `manifest.resumeId` to it, and run with it. `spoken` then answers `false` for a new id and the run starts `--session-id`. A failed write ends the run `unstarted` with the same return shape as the `raiseSliceRuns` failure (`:1672-1674`) and a log line naming the manifest. An empty `manifest.resumeId` is not a rejection here: it already falls through to `deps.sessionId`.
3. **`readPass`.** Ask the same rule for `manifest.resumeId` at `:917` and pass `''` as `readings.resumeId` where it rejects. A pass that ends before any run then records no role handle.
4. **`end`.** Spread `resumeId` only where it is defined and not `''`.

### Settled decisions — do not re-derive them

**The check sits at the launch, through a port.** Alternative killed: check only in `readPass`. `readPass` runs before a hop, and a hop mints a handle and writes it, so a launch-side check is the only one that sees the handle the run actually uses. Both sites stay, because `readPass` is what keeps an ending from recording a role handle when no run happens. Both ask the one rule; neither re-implements it.

**Do not import `continuation.ts`, and check `manifest-stamp.ts` before you import it.** `worker-loop.ts` imports only `continuation-name.ts` from the continuation code so the loop bundle does not pull in `continuation.ts`'s dependencies (`continuation-name.ts:1-6`). The plan names `writeResumeId` (`shared/manifest-stamp.ts:340`) as the writer. Measured 2026-11-22: `manifest-stamp.ts` imports `./registry.js`, and `worker-loop.ts` imports nothing from `shared/` but `continuation-name.js`. Importing it may widen the loop bundle. Decide from the bundle, not by preference: build the loop entry before and after and say the size and the import list in the PR. If the import widens the bundle, write the handle with a small loop-local writer beside `raiseSliceRuns` (`worker-loop.ts:529`) that answers `null`/`false` on failure, and do not use `writeHop`: `writeHop` is best-effort, swallows every error and bumps `wavesCount`, which a replaced handle must not do. The plan's requirement is the behaviour, a failed write ends the run `unstarted`, not the name `writeResumeId`.

**A handle with no transcript stays usable.** `head: null` is not a rejection. A hop mints a fresh handle with no transcript yet, and the loop runs it with `--session-id`. Rejecting `null` would discard every minted handle.

**An unreadable reading is "cannot tell", and the rule answers `usable` for it.** A missing `plot-role-sessions` file, an unparseable first line and an absent `gitBranch` all answer usable (absent is not false). The port must not turn a read failure into a rejection either: answer an empty set and `null`.

**The live ending is not rewritten.** The only writer of `.plot-worker.ending.json` stays the `loop-end` applier (`loop-writes.ts:211-220`). This branch stops the loop writing a role handle into it; it does not repair an existing one. `continuation.ts` already checks that handle on every continuation (wave 1). Alternative killed: a repair write on `desk-033f539d`'s ending — a second writer for a field no reader trusts unchecked.

**No change to the controller's refusals, the continuation prompt or the other manifest readers.** `supervisor.ts:258-260` and `packages/board/src/server/resume.ts:47-57` read the manifest's `resumeId` and stay as they are. After both waves no continuation and no loop run leaves a role handle in a manifest, so both read a checked handle.

### Done when

The plan's `## Design › Tests` entries for slice 2 are the specification. Assertions that exist because a naive implementation would pass without them:

- **`worker-loop-run.test.ts`** (the `rig` harness, `:100`; the hop assertion at `:763-804` is the model): a manifest whose `resumeId` the fake `resumeHandleReadings` reports as a role transcript runs with a `PLOT_SESSION_ID` that is not that handle **and** `PLOT_SESSION_FLAG: '--session-id'`, and the manifest afterwards names the new handle. Asserting only the id passes a fix that mints a handle and still passes `--resume`. A manifest naming the implementer's spoken handle runs `--resume` on it, which catches a check that rejects everything. A failed handle write ends the run `unstarted` and starts no process.
- **The SDK path:** the same role-handle manifest, with an `sdk` request, sends `resumeId: ''` and `sessionId` equal to the new handle. The command path and the SDK path read `handle` separately (`:1676-1679`, `:1723-1728`).
- **`worker-loop.test.ts`** (fake `ports()` at `:26-37`): `readPass` with a role handle in the manifest answers `resumeId: ''`; with the implementer's handle it keeps it. Every fake `ports()` gains the new reading, so add it to the shared fake once.
- **`workflows-agent-loop.test.ts`:** a row 10 blocked pass with `resumeId: ''` produces a `loop-end` write with no `resumeId` key. This test fails on `origin/main`, where the write carries `resumeId: ''`; run it against `main` first to see it fail.
- **The port wiring:** one test that `workerLoopPorts`'s `resumeHandleReadings` answers `roleSessions` and `head` from a real temp desk (a `plot-role-sessions` file and one transcript), so the wiring to the two leaves is exercised once rather than only through fakes. Remove the temp directory by the exact name `mkdtempSync` returned.
- **Role handle never written forward:** a run on a role handle ends with a `loop-end` that carries the new handle, not the role handle. This is the observable the measured desk shows (`resumeId` `f5e4b3c3-…` in the ending).

Plus: add a changeset (package `plot`, description first and the `bumps:` block last; `./scripts/check-changeset-packages.sh` to check). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

New code is arrows (`export const f = (…) => …`), including a new helper in `worker-loop.ts` or a test. Do not convert the neighbouring declarations. TSDoc states what an export does, its parameters, its return and how it fails; the reasoning goes in the commit message.

After merge, the plan's check is a person's: `plot-continue-command.mjs bug/fleetd-counts-in-the-bb-ledger -` on `desk-033f539d` should print `resumes 72aebb9c-09e4-4d6f-a6ab-e52846c8963c`. That is wave 1's output and is not part of this branch.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Before a hand fix of a PR, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`.

### Scope guard

This branch owns: `packages/fleet/src/server/entry/worker-loop.ts` (the port, `workerLoopPorts`, `runPrompt`, `readPass`), `packages/domain/src/workflows/agent-loop.ts` (`end` only), the matching tests (`worker-loop-run.test.ts`, `worker-loop.test.ts`, `workflows-agent-loop.test.ts`), and a changeset. A loop-local manifest writer, if the bundle check requires one, lives in `worker-loop.ts`.

Not this branch: `resume-handle.ts`, `transcript.ts`, `role-sessions.ts`, `continuation.ts` and `continue-command.ts` belong to the merged wave 1. `loop-writes.ts` and `ending.ts` are read, not edited: the empty-handle fix is in `end`.

Expect rebase conflicts only from two Approved plans: `a-refused-start-is-retried-and-named` edits `runPrompt` at about `:1636-1654`, next to the hop mint where this branch inserts its check, and `fleet-state-is-read-whole-and-from-one-home` moves `ContinueRefusal` out of `continuation.ts`. Re-read `runPrompt` after any rebase before you re-insert the check.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
