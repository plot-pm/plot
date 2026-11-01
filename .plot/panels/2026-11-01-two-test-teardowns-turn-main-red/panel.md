# Panel moderation — two-test-teardowns-turn-main-red

Subject: `docs/plans/2026-11-01-two-test-teardowns-turn-main-red.md` (Draft, plan PR #3008, issue #3006). Jurors: layering, safety, testability, seams. Round 1.

**Reconciled: unanimous amend.** All four verdicts name `Position: amend`, and each passed the gate.

## What each juror looked at

| Juror | Read | Ran |
|---|---|---|
| layering | `plan-store-ref.ts`, `stage-dirs.ts`, `fleet.ts`, `helpers.mjs` and `continuation.ts` at `origin/main`; `git log -S` for the onset of the in-process walk | a shape probe of `parseBlobs` (mkdtemp, await a child, remove in `finally`) under SIGTERM: the directory stayed in 5 of 5 runs, and in 0 of 5 with a registered `stage-dirs` handler; `gh run list` on `main` |
| safety | the same files, plus `registryd-main.ts` `stopOnSignals` and `reap.ts --sweep-temp` | `gh run view --log-failed` over every failing `main` run of 2026-11-01; a probe on Node 26.13.0 with `stopOnSignals` and the board's signal installer in one process: one SIGTERM gave exit 143 and no graceful stop |
| testability | the same files, plus `vitest.config.ts` (serial project) and the precedent plans | a shape probe that leaked with and without the re-raise handler (2 of 2, because the probe did not register its directory); matched each leak's timestamp to the serial browser file running at that moment |
| seams | the same files, plus the open PRs and the plan walk's last slice | per-job logs before and after `c1fb09ac8` (0 of 40 vs 7 of 44); a SIGTERM shape probe (exit 143, directory stayed); `gh pr view --json files` on #3009, #3007, #3005; `git grep` counts of bare `rmSync(...recursive` sites |

Every juror ran something. All four probes reproduced the *shape* of `parseBlobs` in a scratch script; no juror ran the real `planStoreRef` under a real board server.

## What they agreed on

1. Slice 1 targets the wrong layer. The `plot-plan-store-ref-*` directory belongs to the board server process, which ends by SIGTERM in the middle of `parseBlobs`; `startServer().kill()` already waits for the server's tree. The fix is production: route `parseBlobs` through the stage-directory registry of #1802, moved into `packages/domain/src/adapters/` because the domain cannot import the board.
2. The plan undercounts: seven runs on 2026-11-01, not two, with onset at #2992's merge. The leaking test is not one test; `stuck-rows`, `tiny-garden.browser` and `dead-fetch` each stopped a board mid-scan. The Open Question is answerable now and changes the slice.
3. Slice 2 waits on the wrong process. The last writer into the desk is the reporter subshell, which has no pid file, not the agent.
4. The sibling real-spawn case (*records the spawned pid's own start time*) carries the same race, and the CI step *A teardown does not race a child* cannot see either case because it counts only `fs.rmSync`.
5. `Type` is `bug`, the caller list is incomplete (`registryd-main.ts`, `refs-git.ts:400`), and #1802 is the precedent, not the 2026-09-01 retry plan.

## Where they differed, and what the plan took

- **fleetd's installer.** Testability and seams asked every entry, fleetd included, to install the full exit-and-signal cleanup; layering made fleetd optional. Safety measured that the signal installer's re-raise reads as fleetd's second signal and skips its graceful stop. **Taken: safety.** fleetd installs an exit-only listener, a test holds it, and the plan states it as a constraint.
- **Slice 2's end condition.** Layering: wait for the reporter's `WorkerMonitor` line, then `removeTree`, for both cases. Safety: wait on the outer shell's process group through a `spawn` wrapper, bounded, no SIGKILL. Testability: inject a fake `spawn` (recommended) or wait for the line. Seams: fake `spawn` for the fleetd case, `removeTree` alone for the real-spawn case. **Taken:** the fleetd case injects a fake `spawn` (testability, seams); the real-spawn case waits, bounded and by state, for the `WorkerMonitor` line and then uses `removeTree` (layering). Seams' `removeTree`-alone relies on a retry window; the line is the reporter's last write, so waiting for it removes the race rather than absorbing it. Safety's process-group wait is not taken: it needs a wrapper the line wait does not.
- **Slice 2's proof.** Safety used `Worker command` = `sleep 0.3`; testability proposed comparing the agent's death with the line. Both carry a time in the fixture. **Taken:** an agent that waits for a file the test creates, so the assertion and the fixture hold no time.
- **Further stage directories.** Only seams named `plot-default-plans-` (#3003) and `plot-draft-plans-` in `fleet.ts`. **Taken:** both stage through the registry in slice 1.
- **The entry-level proof.** Only testability asked for a board-server test besides the domain test. **Taken**, because the board server is the entry CI hit.
- **Counts.** Layering and safety counted 7 of 9 failed `main` runs; testability 8 of 48 `ci.yml` runs (7 store-ref, 2 continuation, one run with both); seams 7 of 44 board-integration runs since `c1fb09ac8`. The figures measure different denominators and do not conflict. The plan uses the seams figure because it names the onset.
- **Optional items.** All four marked the gate widening (bare `rmSync`) or a new `mkdtempSync` gate optional. Safety and seams named the `pushmain.test.mjs` `ENOTEMPTY` as its own issue. Layering proposed a reporter pid file. **Taken:** none as a slice; each is a follow-up in the plan's Notes.

## Shared blind spots

- **No juror ran the real code path.** Every leak-1 probe reproduced the shape of `parseBlobs`, not `planStoreRef` in a board server. Testability's probe even leaked *with* the re-raise handler, because it did not register its directory; that result supports the fix, but no juror proved the fix itself. The plan's Done-when rows close this: a real `planStoreRef` child and a real `startServer`.
- **All four lenses inherited the issue's two prefixes.** Seams named `plot-default-plans-` and `plot-draft-plans-` as unregistered, but nobody counted whether they have leaked yet; `plot-default-plans-` only reached `main` at 15:47Z on 2026-11-01. The delivery observation therefore counts all four prefixes, not the two that failed.
- **The operator-machine exposure is reasoned, not measured.** Three jurors state that `node --watch` restarts and `/plot-board --stop` leave directories in an operator's `TMPDIR`; none listed a real `TMPDIR`. The claim holds by the same mechanism, but the plan gives no count for it.
- **SIGKILL is out of reach of every fix proposed.** `helpers.mjs` `kill()` escalates to SIGKILL after its bound, and no listener runs then. Only safety's O3 touched this, for fleetd. The plan records it in Notes; under CI load an escalation can still leave one directory, which the 30-run observation would show.

## Outcome

The plan is amended from this panel and records `- **Rounds:** 1`. Its slices are `bug/a-stopped-process-leaves-no-plan-stage-directory` and `bug/the-continuation-tests-remove-desks-after-the-last-write`; neither waits on the other.
