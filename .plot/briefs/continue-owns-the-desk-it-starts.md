## Implementation brief — a-controller-owns-what-it-starts (wave 1: Continue owns the desk it starts)

- **Plan (canonical):** `docs/plans/2026-10-07-a-controller-owns-what-it-starts.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/continue-owns-the-desk-it-starts` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a person reading the diff)
- **Issues:** #1294 (two loops on one desk), #1307 (a board restart stops continued agents)

This is wave 1 of 2 and nothing waits on it except wave 2 (`bug/a-claim-has-a-release-controller`), which is eligible only after this one merges. `every-loop-ending-has-a-supervisor-rule` slice 1 waits on wave 2, so this branch is the head of that chain.

### What to build

`continueOnDesk` (`packages/board/src/server/continue.ts:596`) starts a new loop on a blocked desk and never asks whether the old one still runs. On 2026-10-05 three loops ran on one desk (#1294). Two things are missing:

1. **A `loop-alive` refusal.** Before any write to the desk, read the pids the desk records and refuse when one is alive. The pids are `.plot-worker.pid` (the file `deskPidAlive` reads, `registry.ts:137`) and the manifest's `pid` and `wrapperPid` (the manifest is already in hand as `manifestAnswer.path`; `recordedMonitorPids` at `:531` shows how the file is read). The 409 names the pid and the file it came from.
2. **A continued loop outside the board's process tree.** The spawn at `:734` already passes `detached: true` and calls `child.unref()`, and that is not enough: `detached` calls `setsid`, which starts a new session and leaves the parent pid alone. `plot-boardctl.sh` stop finds a board's agents with `tree_pids` (`:173`), which walks `ppid`, so a continued loop is still a board descendant and receives the TERM. The loop has to be re-parented to pid 1.

Close by reading the plan: it is canonical, this is orientation.

### Decisions the plan settles — do not re-derive them

**Refuse a live loop; do not stop it and start.** The plan's one Open Question is answered: a stop can lose a turn in progress. No `kill` in `continueOnDesk`. The caller who wants the old loop gone stops it and asks again.

**`detached: true` does not leave the tree. Measured 2026-10-07 on this machine (Darwin 24.6):**

| spawn | child's `ppid` |
|---|---|
| `spawn('sh', ['-c', 'sleep 30'], { detached: true })` | the spawning node process |
| `spawn('sh', ['-c', '(sleep 30 & echo $! > f)'], { detached: true })`, grandchild | `1` |

So the fix is a second process level, not a flag: the spawned `sh` backgrounds the real command and exits, and `init` adopts it. `tree_pids` then finds no agent under the board. A test that asserts `detached: true` in the spawn options passes today and proves nothing; assert the loop's `ppid` is not the board's pid.

**The real pid is the grandchild's.** `child.pid` after the change names the intermediate shell, which has exited. The shell must hand the backgrounded command's pid back (`$!`), and `.plot-worker.pid`, the manifest stamp (`writeManifestStamp`) and the 202 reply must all carry that pid. The `( cmd ); rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"` shape stays inside the backgrounded subshell so the exit file keeps its meaning. Redirect the backgrounded job's output to the log, or an open pipe keeps the intermediate's reader waiting.

**The refusal sits after the `no-manifest` check and before `beforeStart`.** `beforeStart` is the supervisor's side effect (`registryd-main.ts:1562` passes `continueOnDesk` into `startFreshSession`), and the existing test *"does not call beforeStart for a desk it refuses"* (`continue-route.test.ts:961`) holds that a refused desk triggers nothing. Both callers reach the refusal, so `ContinueRefusal` gains `loop-alive` and every consumer of the union (grep `ContinueRefusal` and `reason`) must handle it. The supervisor reads a refusal as *do not start*; check it does not retry every tick.

**The liveness rule is a domain rule over readings.** Per *The Layering Rule*, the decision is `(pids, aliveness) -> the first live pid or none` as an arrow function in `packages/domain/src/rules/` with a unit test; the `kill -0` readings belong to the caller. The domain does no I/O.

**EPERM reads as alive here.** `deskPidAlive` reads `EPERM` as not-alive on purpose, because there a wrong *alive* invents a worker. This refusal is the opposite direction: a wrong *not-alive* starts a second loop, which is the defect. Do not reuse `deskPidAlive` unchanged. An absent, empty or non-numeric pid is not alive (*absent is not false* cuts both ways: no record means nothing to refuse on).

**A pid can be recycled.** A stale pid file whose number a new process now holds refuses a continuation wrongly. Accept it: the refusal names the pid and the file, so a person sees the cause, and the wrong start is the worse failure. Do not add a command-line match.

**Carried over unchanged from slices already on `main`:** the refusal comes before every write (`.plot-continuation.md`, the log, the removed `.plot-worker.exit`, the resume id); `several` manifests are refused and not tie-broken; `.plot-worker.wrapper.pid` is removed with `force: true` before the spawn; `.plot-worker.pid` is overwritten, never removed.

### Done when

The plan's `## Done when` list is the specification. Each test below must FAIL on `origin/main` and PASS on the branch; run each against `main` before claiming it.

- **`continue-route.test.ts`, refusal:** start a real loop on the desk (a `sleep` whose pid is in `.plot-worker.pid`), call continue, and assert 409 with reason `loop-alive` and the pid in the body. Assert in the same test that exactly one process holds the desk, that `.plot-continuation.md` does not exist, that the log is unchanged, and that the manifest bytes are unchanged. The last three catch a refusal placed after the prompt write.
- **Refusal on each pid source:** one case each for `.plot-worker.pid`, the manifest `pid` and the manifest `wrapperPid`, with only that one alive. A single case on the pid file passes an implementation that reads one source.
- **Dead pid still continues:** a desk whose recorded pids are all dead gets 202. The existing fixtures use `'424242'`; confirm it is dead on the machine, and prefer a pid you started and reaped.
- **`beforeStart` is not called** for a `loop-alive` desk (extend the `:961` case).
- **Re-parenting:** after a 202, the new loop's `ppid` is `1`, read from `ps` for the pid in the reply. The pid in the reply, in `.plot-worker.pid` and in the manifest are the same number and name a live process, not the intermediate shell.
- **Survives a stop:** start a continued loop under a board started the way `plot-boardctl.sh` starts one, run `stop`, and assert the loop is alive. Read `plot-boardctl` tests first for the fixture; a loop that is alive only because the TERM missed it by timing proves nothing, so assert on `tree_pids` output not containing the loop pid.
- **Exit file:** a continued command that exits 3 leaves `.plot-worker.exit` holding `3`.
- **The domain rule:** unit test with the three readings (none, one, several live) and a non-numeric pid.

Plus: a changeset for `@plot-pm/board` (patch; description first, `bumps:` block last, per `CLAUDE.md` *Versioning*), and no committed bundle: `board-server.mjs` is generated, `main` rebuilds it, and `scripts/check-no-bundle-diff.sh` refuses a diff that carries one. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to say; if you find you need one, the growth is paid for in the same change.

Tests that spawn a detached loop need a launch-time sentinel and must wait on the loop's own pid, not a process name. Do not run board tests while an operator's board is open on the machine.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/continue.ts`, `packages/board/test/unit/continue-route.test.ts` (and `continue.test.ts` / `continue-control.test.ts` if a union change reaches them), one new rule file and its test under `packages/domain/`, and one changeset. It may touch `registryd-main.ts` only to handle the new refusal reason.

Out of scope: `plot-boardctl.sh` (its walk is right; the continued loop must not be in the tree), `deskPidAlive` and `PidLiveness` (leave their EPERM direction alone), anything in `POST /api/release-claim` or `plot-ask.mjs` (wave 2), and the supervisor's retry policy beyond reading the new reason.

In flight on `origin`: `plot/approve-every-loop-ending-has-a-supervisor-rule` (a plan-approval branch, no code), so no code branch collides with these files at dispatch (`git branch -r`, 2026-10-07). Wave 2 of this plan edits board routes and `plot-ask.mjs`, not `continue.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
