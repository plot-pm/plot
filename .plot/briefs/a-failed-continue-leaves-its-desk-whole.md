## Implementation brief — manifest-retry-and-race-findings (wave 2: Start and stop)

- **Plan (canonical):** `docs/plans/2026-10-17-manifest-retry-and-race-findings.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1968 merged
- **Branch:** `bug/a-failed-continue-leaves-its-desk-whole` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on `main`)

This branch waits on `bug/a-continue-starts-one-loop`, merged 2026-10-18 as PR #2034 — its per-desk continuation lock is already in `packages/fleet/src/shared/continuation.ts` and `packages/fleet/src/shared/continue-lock.ts`. Both branches edit `continuation.ts` and `packages/board/test/unit/continue-route.test.ts`; the predecessor's own brief explicitly left every item below untouched so the two would not collide. Nothing here should touch the lock (`acquireContinueLock`/`releaseContinueLock`/`released`/`release()`) — it is correct and merged.

### What to build

Five independent gaps, all in `continueOnDesk()` (`packages/fleet/src/shared/continuation.ts`) and its manifest writer (`packages/fleet/src/shared/manifest-stamp.ts`). Re-verify each against current `main` before changing code — the plan's own instruction — but all five were re-confirmed present on the post-fast-forward file as of this brief:

1. **Manifest written before the prompt and log, not after (#1373).** `writeDeskManifest(...)` runs at line 751, inside the `target.manifest === 'write'` branch, well before `promptPath` is composed (line 794) and the log is opened (line 810). A failure in either of those later steps (`fs.writeFileSync` throwing, `fs.openSync` throwing) returns `{ kind: 'failed', ... }` with the freshly written manifest left on disk — a desk that looks registered and holds no running loop. Fix: move the `writeDeskManifest` write (and the `assignEmptyManifestBranch`/`writeResumeId` calls that depend on `manifestPath`) to just before the spawn (currently line ~875), after the prompt write and log open have both already succeeded. Where that reorder is not possible without disturbing code this slice does not own, the alternative the plan names is acceptable: remove the manifest on each `failed` return between the write and the spawn.

2. **The stop proceeds even when the pre-stop manifest read is null (#1379).** Lines 708–739: `manifestBeforeStop` is read at line 713 *before* the stop block, but the `null` check only fires at line 736 — *after* `stopAndAwaitExit` has already signalled and awaited the pid (lines 725–727) and the freewait file has already been removed (731–735). A stop that cannot be reversed (because there was never a valid `manifestBeforeStop` to restore) still happens. Fix: when `stampPath !== ''` and `manifestBeforeStop === null`, refuse `no-manifest` *before* calling `stop(pid)` — the loop keeps running, nothing is signalled, and the desk is left exactly as found.

3. **The stop waits only for the loop pid, never the manifest's `wrapperPid` (#1379).** `stopAndAwaitExit(pid)` (line 725, defined line 483) polls `process.kill(n, 0)` for exactly the one pid `target.stop` names — `continueTarget`'s `StopFirst.pid`, which is `deskLoopAlive`'s reading, never a wrapper. `recordedMonitorPids` (line 406) reads only `agentMonitorPid`/`buildMonitorPid` from the manifest JSON — no `wrapperPid` field is read anywhere in this file. So the dispatcher's wrapper (`plot-dispatch.sh`'s `sh -c '( cmd ); rc=$?; printf ... > .plot-worker.exit'`) can still be mid-flight, write `143` to `.plot-worker.exit` after this route already removed that file during the new start, and leave a `gone`-reading race — same shape as the wrapper finding #1377 already fixed on the *start* path, needed here on the *stop* path. Fix: after `stopAndAwaitExit(pid)` succeeds, also read the manifest's `wrapperPid` (before it's overwritten) and wait for that pid to exit too, the same way the start path already waits for its own spawn.

4. **No `warning` field on a failed post-start stamp (#1379, LOW).** The `started` variant of `DeskContinuation` (lines 321–332) carries `pid`, `previousPid`, `prompt`, `log` — no `warning`. At lines 963–969, a failed `writeManifestStamp` after the loop is already running only logs to the log file and `console.error`; the HTTP response (`continue.ts:189-198`) has nothing to carry that forward, so the caller sees a clean 202 for a desk whose registry row may now be stale. Fix: add an optional `warning?: string` to the `started` variant, set it to the same line already composed for the log (line 966) when `writeManifestStamp` returns false, and thread it into `continue.ts`'s JSON response body.

5. **`writeDeskManifest` has no corpus parity coverage (#1373, MEDIUM).** `packages/domain/corpus/agent-manifest.corpus.test.ts` already compares `agentsFs(...).register` against `plot-dispatch.sh`'s shell `write_agent_manifest`, field by field, via `compareField`/`describingAs` (see `SIDES = { left: 'register', right: 'shell' }`). `writeDeskManifest` (`packages/fleet/src/shared/manifest-stamp.ts`) writes a third, independent implementation of the same manifest shape (`session, resumeId, branch, worktree, command, loop, slug, pid, attempts, startedAt`) and is covered by neither side. Fix per the issue's own recommendation: either give `agentsFs(...).register` an optional `resumeId` parameter and extend the existing corpus test to a third `SIDES` comparison, or add `writeDeskManifest` as a documented third side in the same file. Do not invent a fourth, separate corpus file — the declared-duplicate pattern lives in one file per manifest shape.

### The decisions the plan settles — do not re-derive them

**Save-then-signal is the shape, not stop-then-check.** The plan's Design section says it plainly: *"Save the manifest first. A `null` save refuses `no-manifest` before the loop is signalled."* The code today reads the manifest first (correct) but still signals before checking it was readable (not yet correct) — finding 2 above is closing exactly that gap, not inventing a new one.

**The timeout-restore mechanism already exists and is correct; only its trigger is ambiguous without a real pre-stop guard.** `restoreManifest(file, text)` (writes back via tmp+rename only `if (!fs.existsSync(file))`) and the `stopped.ok === false` → `refused(409, 'loop-alive', ...)` path already compose correctly for a signal that outright failed (`EPERM`/unsignallable). What is still open is the ordering of the *null-manifest* case relative to the signal (finding 2), which is a distinct failure mode from a signal that failed or timed out.

**The freewait filename stays the one place it is defined.** `FREE_WAIT_FILENAME` (`packages/domain/src/rules/desk-loop-alive.ts`) is already the single definition; this branch reads it, never redefines it. The predecessor slice settled that consolidation — don't touch `desk-loop-alive.ts`.

**`continueTarget()` and `deskWaitsFree()` are merged, correct domain rules — read them, don't re-derive their contract.** `packages/domain/src/rules/continue-target.ts` already encodes "a stop can land mid-turn, EXCEPT a loop that reported its own pid waiting free" and "absent is not a fallback" (an unreadable/absent ending record never answers `write`). Nothing in this slice's five findings requires changing either rule — the gaps are all in `continueOnDesk`'s *sequencing* of calls into them and into `fs`, not in what the rules themselves decide.

**Rules carried over unchanged, worth restating because this file violates them today in the exact ways findings 1–3 name:** absent is not false (an ending record the caller could not read is never treated as a definite `write` verdict — already correct, not part of this slice); a refusal happens before any write (the comment at lines 662–667 states this as the file's own contract — finding 2 is where the code does not yet live up to its own stated invariant); atomic writes via temp-file + rename for every manifest mutation (`writeManifestStamp`, `writeResumeId`, `assignEmptyManifestBranch`, `restoreManifest` all already do this — keep it for whatever `writeDeskManifest` call site moves).

### Done when

The plan's slice line is the spec: *"manifest written last, `no-manifest` refused before the stop, the manifest restored on a stop timeout, the `warning` field and the corpus parity for `writeDeskManifest`."* Concretely, each of these must fail on an unmodified `main` first:

- A route test that makes the prompt write (or log open) throw after a `write`-verdict manifest was created, and asserts the manifest file no longer exists afterward (or was never created before the throw, if the reorder approach is taken). Catches finding 1 — it fails today because the manifest survives.
- A route test with a `stamp`-verdict target, a live pid reporting a free wait, and a pre-stop manifest read that returns `null` (e.g. the file is unreadable or briefly missing) — assert the loop is `refused('no-manifest', ...)` and that `process.kill`/`stopLoop` was never called. Catches finding 2 — it fails today because the stop runs regardless.
- A route test with a real child process standing in for both the loop pid and a second "wrapper" pid, where the loop pid exits promptly but the wrapper pid does not — assert the route waits for both before returning, or at minimum that a wrapper exiting after the route answers does not later corrupt the new run's `.plot-worker.exit`. Catches finding 3.
- A route test where `writeManifestStamp` is made to fail after a successful spawn — assert the JSON response carries a `warning` field with a message naming the manifest path, not just a clean 202. Catches finding 4 — fails today because the field doesn't exist on the type.
- A corpus test asserting `writeDeskManifest`'s output and `agentsFs(...).register`'s output (or the shell's `write_agent_manifest`) agree field-by-field for the same inputs. Catches finding 5 — fails today because no such test exists, so a future drift between the two writers would go unnoticed exactly as #1373 found.

Plus the repo gates: a changeset (patch — this is a `bug/` branch) naming `plot` in `.changeset/`, with the description first and any `bumps:`/`plan:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests and typechecks for the packages this branch touches (`packages/fleet`, `packages/board`, and `packages/domain` if `agent-manifest.corpus.test.ts` is extended) from the changed-file list, so there is no need to guess which suite applies. The suites under the `CI suites` config key run in CI on every PR; do not run `pnpm run test:e2e` locally — it dispatches real workers into sandbox repos and is CI's gate, not a local one (see CLAUDE.md § Testing).

Name the shell gate if any `.sh` file under `skills/` changes: `scripts/check-shell-lines.sh` refuses growth past this branch's merge base with no override; this slice's changes are all TypeScript, so this gate should not trigger, but check if it does.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads the plan, titles the PR from the wave heading ("Start and stop"), and links the plan and this brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under `### Start and stop`.

### Scope guard

**Owns:** `packages/fleet/src/shared/continuation.ts` (the five findings above), `packages/fleet/src/shared/manifest-stamp.ts` (if the write-order fix moves code here), `packages/board/test/unit/continue-route.test.ts` (new test cases for each finding), `packages/domain/corpus/agent-manifest.corpus.test.ts` (extended for finding 5) or a declared-duplicate extension to `packages/domain/src/adapters/agents/agents-fs.ts`.

**Does not own, and must not touch:** `packages/domain/src/rules/continue-target.ts`, `packages/domain/src/rules/desk-loop-alive.ts`, `packages/fleet/src/shared/continue-lock.ts`, or anything already merged in `bug/a-continue-starts-one-loop` (PR #2034) — the start-lock, the spawn `'error'` path, the stale-pid handling, and the one definition of `FREE_WAIT_FILENAME` are settled and correct. The two remaining siblings in this plan, `bug/a-continuation-obeys-the-limits` and `bug/an-unstarted-continue-resumes-no-stranger` (wave 3, Continuation), have not started and hold run/spend limits, retry semantics, and the resume-id transcript fix — distinct code paths (`runLimitEnding`/`spendLimitEnding`, `readContinuation`, `CONTINUATION_NAME`'s module location) this branch does not need to anticipate.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
