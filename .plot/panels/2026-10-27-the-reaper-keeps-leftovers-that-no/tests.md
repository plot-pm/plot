# Juror verdict — lens: tests

Plan: `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` (PR #2758). Code read at `pmain` (`4a1b8a5fa`). Every claim below says whether I **read** it or **ran** something.

Position: amend

## Summary

The three defects are real, and each one can be held by a test that fails on today's code. The plan does not say what those tests are. It says "each slice adds one test", names the wrong rule file for two of three slices, names a launcher as a corpus duplicate, and misses two existing tests whose fixtures already encode the old behaviour. One of them (`sweep.test.mjs:294`) is exactly the #2705 fixture with the opposite assertion. An implementer who meets it with no instruction either breaks it or "adjusts" it, which is the move the repo forbids. The acceptance needs to name the fixtures, both arms, and the existing tests that change.

## 1. The problem, traced

**#2697 — pid reuse.** (read) `reap.ts:312-319` `deskWorkerPid` asks `processes.workerState` first. That shell path already guards reuse: `plot-worker-state.sh:301-337` `plot_pid_is_current` compares `ps -o lstart` with the manifest's `startedAt` (3 s slack), and `:1244-1250` returns `ended` on a reuse. `processWorkerPid` (`reap.ts:278-296`) maps `ended` to `''`. The entry then falls through to `deskLoopAlive({ pids: recordedLoopPids(manifest), alive: pidAliveEverywhere })` (`reap.ts:317`). `pidAliveEverywhere` (`packages/fleet/src/shared/desk-loop.ts:39-46`) is `process.kill(pid, 0)` and reads `EPERM` as alive. `rules/desk-loop-alive.ts:67-71` documents that a recycled pid reading alive "is accepted". So the reuse guard exists in shell and the TS fallback discards its answer. (ran) `node -e` with the same function on pid 1 (launchd, `lstart` Sat Oct 17 2026) answers `true`.

There is a second path the plan must not miss. (read) `plot-worker-state.sh:1241-1243`: with no `startedAt`, `kill -0` alone decides. The issue's report line `worker alive (pid 52915)` does not say which source named the pid. So the slice must first establish whether #2697's desk came through the manifest fallback or through a `.plot-worker.pid` with no `startedAt`. Each needs its own fixture.

**#2705 — local-only claim.** (read) The claim rule is `claimSweepProblems` in `packages/domain/src/rules/sweepable.ts:146-155`, not `reapable.ts`. It refuses `needs-judgment` whenever `claimDisposition` (`reap.ts:942-961`) is not `abandoned`. `runClaimKind` (`reap.ts:963+`) iterates local branches only and never reads whether `origin/<branch>` exists. `plot-dispatch.sh:2186-2190` exits 0 with "holds no claim" when no remote ref and no manifest exist. Account confirmed.

**#2714 — deferred desk.** (read) `reapProblems` (`reapable.ts:111-145`) refuses `blocked-marker` whenever `markerRecordsWork !== false`. `reap.ts:640-651` sets `markerRecordsWork` true when `origin/<default>..HEAD` has a file-changing commit, which a deferred slice with pushed work always has. It then refuses `no-merged-pr`, because `MergeReading` (`reapable.ts:13`) is `merged | not-merged | unreachable` and has no closed-unmerged value. Both refusals in the issue's report follow. Account confirmed.

## 2. The approach against the code (test-relevant points)

- **Name the right rules.** #2697 changes `rules/desk-loop-alive.ts` (and its reading), #2705 changes `rules/sweepable.ts`, and only #2714 changes `rules/reapable.ts`. The test files follow: `packages/domain/test/desk-loop-alive.test.ts`, `packages/domain/test/sweepable.test.ts`, `packages/domain/test/reapable.test.ts`. (read)
- **#2697 reuses an existing mechanism.** The comparison already exists: manifest `startedAt` against `ps -o lstart`. The plan's open question "which signal" has an answer in the tree. The domain rule takes a process start time as a reading; an adapter (processes port) reads it, because the spawn ratchet (`ci.yml`, *One place reaches a process*) counts `ps` spawns outside `adapters/`.
- **#2697 has more callers than the reaper.** (read) `deskLoopAlive` is called from `continue-target.ts`, `ending-action.ts`, `fleet/.../desk-loop.ts`, `registryd-main.ts`, `continuation.ts`, and `board/plot-desk-loop.mjs` serves `plot-dispatch.sh --start/--stop/--restart`. Its documented bias ("a wrongly-skipped refusal — a second loop on the desk — is the worse failure") protects those callers. A test must hold that a pid whose process started at or after `startedAt` still reads alive, and that a pid with no `startedAt` still reads alive exactly as today. Otherwise the fix trades a kept desk for a second loop.
- **#2714 reuses the `unpushed` reading.** "Head on the remote" is what `TreeReadings.unpushed` (`reapable.ts:63-72`, `reap.ts:349-376`) already measures. A new head-equality reading would be a second implementation of the same question.

## 3. Safety, as tests must hold it

- #2697: a live process whose start time precedes `startedAt` must read not-alive, and **`--stop` must not signal it**. Today `--stop` reads the same `deskLoopAlive` answer, so a reused pid may receive a signal meant for the worker. That is worth one assertion in the slice.
- #2705: a local-only empty claim that a manifest names (a claim between its local commit and its push, or an agent holding it) must be kept. A remote ref whose presence could not be read must keep (`unknown` refuses, as everywhere else in `reapable.ts`).
- #2714: the reap must leave `origin/<branch>` in place (the issue says the work stays on the remote; the plan's Approach §3 says "removes the desk and its refs", which contradicts it). Merge state comes from the host's `prMerged` (`mergedAt`), closed-unmerged from `prState`, never from ancestry.

## 4. Slices and acceptance — the proof each slice needs

### Pid reuse (#2697)

Fails today: yes, with the right fixture. Fixture: spawn a real child (`sleep 30`), write a manifest whose `pid` is the child and whose `startedAt` is **one hour in the future**, with no live agent under `.plot-worker.pid`. Old arm: `keep … worker alive (pid N)`. New arm: the desk is reaped (or kept for another named reason). The arms disagree on the reason column, so assert the row, not only the exit code.

Opposite arms that must stay green: the same child with `startedAt` one hour in the past reads alive; a manifest with no `startedAt` reads alive (`kill -0` only), as `reap-agent-liveness.test.mjs:266` ("a desk with a live agent is kept, and the refusal names the pid") already holds without any manifest. If the new rule reads absent `startedAt` as not-alive, that test fails, and it must not be edited to pass.

Flakiness: do not rely on real pid reuse; it is not reproducible. A future `startedAt` far outside the 3 s slack and Linux procps skew (`SKEW_MS` in `test/reconcile/own-process.mjs`) is deterministic under load. Await the child's exit in teardown (`own-process.mjs` `record`/`signalOwn`), or `owned-run.sh` fails the run on the leaked entry.

Domain unit test: `desk-loop-alive.test.ts` gains readings with a start time and `startedAt`, covering before / at / after the slack edge and absent `startedAt`.

Corpus: if the domain gains a pid-currency rule while `plot_pid_is_current` stays in `plot-worker-state.sh`, that is a declared duplicate under *A Shell Script Asks The Domain*, and it needs a corpus pair in `packages/domain/corpus/` that feeds both the same `(lstart, startedAt)` rows, including the slack edge and the `-u` UTC parse. The alternative is that the TS fallback asks `workerState` and never re-derives currency; then no pair is needed. The plan must choose.

### Claim branch (#2705)

Fails today: yes. Fixture: `claimBranch` in `test/reconcile/sweep.test.mjs:80-84` already makes a local-only empty claim with no push and no manifest. Old arm: `keep … needs judgment`. New arm: removed under `--yes`.

**Conflict with an existing test.** (read) `sweep.test.mjs:294-308` ("a bare `claimed:` is reported and left for a person") uses that exact local-only fixture and asserts the branch survives `--yes`. The slice must change that test's fixture to push the claim to origin (so it keeps holding the slow-worker arm) and add the local-only arm beside it. The plan must say so; otherwise the change looks like a test edited to pass.

Further arms: local-only + a manifest names the branch → keep; remote ref unreadable → keep; local-only + carries a real file (`sweep.test.mjs:310`) → still keep. Domain unit test in `sweepable.test.ts` with a new remote-ref reading.

Layer: the reap entry (TS) is the testable home. Fixing it in `plot-dispatch.sh --release` adds shell lines to a *decision* script and pays under `check-shell-lines.sh` and `check-decision-count.sh`.

Report text: `quiet-kinds-render.browser.test.ts:159` ("shows an orphaned claim in the sweep's own words") and `sweep.test.mjs:305` match the wording. A new row reason needs both updated or both left untouched; the plan's last open question must be answered per slice.

### Deferred desk (#2714)

Fails today: yes. Fixture: desk with a file-changing commit pushed to `origin/<branch>`, an untracked `PLOT-BLOCKED.md`, plan line with `<!-- deferred: … -->`, and a stubbed host answering `prMerged` not-merged and `prState` `CLOSED`. Old arm: `keep … PLOT-BLOCKED marker`. New arm: reaped, marker text saved (as `reap-manifest.test.mjs:217` does), `origin/<branch>` still present.

Opposite arms, each one alone flipped: PR `OPEN` → keep; no deferral line → keep; an unpushed commit → keep and name the sha; a dirty path besides the marker → keep; host unreachable → keep; an earlier PR on the branch merged → existing merged path, not this one.

Bitbucket: `plot-host.sh:624` normalises `DECLINED` to `CLOSED`. One fixture through the Bitbucket stub proves the new reading on both hosts. Do not add it to `host.test.mjs`, which does not complete under load; put it in the reap test file.

## 5. New defects and gates

- `Local checks` for these paths: `packages/domain/**` vitest related plus `tsc`, `packages/board/src/**` vitest related plus typecheck, `test/reconcile/*.test.mjs`, and the `scripts/check-*.sh` set. `test/reconcile/sweep.test.mjs` and `reap-agent-liveness.test.mjs` run the built `plot-reap.mjs`, so a local run needs `pnpm build:board` first, and the generated bundle must be restored before push (`check-no-bundle-diff.sh`).
- The plan's corpus sentence names `plot-reap.sh`, which is a 13-line launcher (`skills/plot/scripts/plot-reap.sh`, read) and duplicates nothing. The real duplicate candidate is `plot_pid_is_current`.
- "Each slice adds one test" cannot make the arms disagree in both directions. Each slice needs at least the failing arm and the opposite arm named above.
- No gate is needed beyond the corpus pair for #2697, if the plan chooses to duplicate.

## Amendments

1. Name the rule each slice changes: `rules/desk-loop-alive.ts` (#2697), `rules/sweepable.ts` (#2705), `rules/reapable.ts` (#2714), and the matching domain test file for each.
2. #2697: state the existing mechanism (`startedAt` against `ps -o lstart`, `plot-worker-state.sh:301-337`) as the comparison, read through the processes adapter. Choose between asking `workerState` only and a domain rule with a corpus pair against `plot_pid_is_current`; if the latter, name the corpus file.
3. #2697 acceptance: a live child with `startedAt` one hour in the future is not read as alive by the reaper or signalled by `--stop`; the same child with a past `startedAt` and a manifest with no `startedAt` stay alive; `reap-agent-liveness.test.mjs:266` stays green unedited. First establish which pid source produced the #2697 report.
4. #2705: name `sweep.test.mjs:294` as a test whose fixture changes (push the claim) and add the local-only arm beside it, plus the manifest-names-it and remote-unreadable keep arms.
5. #2705: put the removal in the reap entry, not in `plot-dispatch.sh --release`, and say so (testable in the domain, no shell-line cost).
6. #2714: replace "removes the desk and its refs" with "removes the desk and leaves `origin/<branch>`", and assert the remote ref survives.
7. #2714: reuse `TreeReadings.unpushed` for "head on the remote", add a closed-unmerged reading from `prState`, and list the six single-flip keep arms above as acceptance, with one Bitbucket (`DECLINED`) fixture.
8. Answer the report-text question per slice, and name `quiet-kinds-render.browser.test.ts:159` and `sweep.test.mjs:305` if any wording changes.
9. Remove `plot-reap.sh` from the corpus sentence; it is a launcher.
