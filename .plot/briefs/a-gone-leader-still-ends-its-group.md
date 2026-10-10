## Implementation brief — the-tests-and-gates-close-their-review-findings (wave Group signal after exit)

- **Plan (canonical):** `docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md` on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1495 merged
- **Branch:** `bug/a-gone-leader-still-ends-its-group` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

First wave of eight. Nothing waits on it to start, but slice "Board test
signals" moves board and e2e kill sites onto `signalOwn` and so cannot merge
before this one does — the helper it depends on changes here.

### What to build

Closes issue #1489's M1 and L1–L3 findings against
`test/reconcile/own-process.mjs`, `workerloop.test.mjs`, `restart.test.mjs`
and `workerstate.test.mjs`. None of these are shipped code — they are the
contract-test helper estate — so no changeset.

**M1, the real defect.** `test/reconcile/dispatch.test.mjs:3436` `endDesk`
SIGTERMs a desk's wrapper group with
`signalOwn(rec.pid, 'SIGTERM', { ...own, group: true })`. `signalOwn`
(`own-process.mjs:97-106`) currently calls `isOwn(pid, expect)` first and
signals nothing when it returns false — and `isOwn` returns false whenever
`identityOf(pid)` finds no process at all, which is exactly the shape a
wrapper that has already exited presents. The group's other members
(`plot-agent-monitor.sh`, in this case) are still alive under the same pgid,
and the SIGTERM never reaches them. The test that drives this
(`endDesk`/`killDeskGroup` fixtures) then removes the desk directory while the
monitor is still running inside it.

### The decisions the plan settles — do not re-derive them

**A pgid is not reused while any member of the group is alive.** That is why
"leader pid is gone" is safe to treat as "the group id still names this
group" rather than "the group might not exist" — the OS does not hand out a
pgid to a new, unrelated group while a process still holds it. So
`identityOf(n) === null` is not an ambiguous signal here; it specifically
means *the leader exited, something else in its group may not have*, and the
group number is still trustworthy enough to signal.

**The fix is `group: true` AND `identityOf(n) === null`, not a blanket
loosening of `isOwn`.** `isOwn` must stay strict for the non-group case — a
plain `signalOwn(pid, sig)` with no `group` must still refuse a reused pid,
because nothing there protects against signalling an unrelated process that
inherited the number. The new branch is specific to the group form, where the
group-identity argument above applies and the plain-pid case does not.

**`sleepCount`'s L1 is a real bug in dead code.** `workerloop.test.mjs`'s
`serial` constant (`:40`) already carries
`skip: 'the JS loop takes its branch from the manifest, not PLOT_BRANCH'` —
every test using it is unreachable today. The `reap(secs)` calls at `:303`,
`:346`, `:379`, `:414` run *before* `runLoop` adds the loop's pid to
`ownGroups` (`:181`), so `reap`'s own-group filter (`:291`,
`!ownGroups.has(...)`) discards every candidate and the pre-test cleanup is a
no-op — `sleepCount` itself still counts machine-wide via bare `pgrep -f`.
Fix it because the plan names it and the file stays in the tree, not because
it fires in CI today.

**L3 is a one-line gap, not a design question.** `workerstate.test.mjs:708`
spawns `idle` (`spawn('sh', ['-c', 'sleep 30'], { stdio: 'ignore' })`) without
`detached: true`, unlike its neighbour `busy` two lines above, which the
file's own comment at `:702-705` explains needs `detached: true` so the
group-kill in `finally` can reach a spinning grandchild. `idle`'s cleanup
(`:726`) already does `process.kill(-idle.pid, 'SIGKILL')` — a group signal —
against a process that was never made its own group leader, so it signals
the wrong group (or none) and leaves `sleep 30` to the test runner's shared
group instead. Add `detached: true` to the `idle` spawn; nothing else in that
test changes.

**L2, `endManifestWorkers`.** It currently matches `command: 'sleep 300'`
(`restart.test.mjs:228-234`). The finding says this token is not unique to the
fixture's own spawn — `spawnLive` (`:220-224`)'s wrapper script,
`nohup sh -c 'sleep 300 & exec sleep 300' …`, contains the literal substring
`sleep 300` in its *own* command line too (the `sh -c '...'` argument), so a
command-line match against `'sleep 300'` can match the wrapper's `sh`
invocation as well as the two `sleep 300` children it spawns. Pick a token
that appears only in the actual `sleep 300` descendant's command line (for
example anchor on it as the whole command, or distinguish by matching the
process name together with the argument) and say in the diff why the chosen
token cannot also match the `nohup sh -c '...'` line.

### Done when

The plan's `## Done when` is implicit per-slice here (the plan carries no
top-level `## Done when` section; the per-slice bullet under "Group signal
after exit" is the contract): `signalOwn` signals the group of a gone leader,
`sleepCount` counts only its own groups, `endManifestWorkers` matches a
fixture token, and `idle` leads its own group.

Concretely:
- A unit test in `own-process.test.mjs` (new or existing file under
  `test/reconcile/`) holds the M1 case: a recorded pid that no longer names a
  live process, signalled with `group: true`, still delivers the signal to
  the group. This is the assertion a naive "just loosen `isOwn`" fix would
  fail if it weakened the non-group path instead.
- `sleepCount`'s pre-test `reap(secs)` calls stop being no-ops — demonstrate
  this without un-skipping the `serial` tests wholesale (they are skipped for
  an unrelated reason, the JS loop takeover); a narrow test or a comment
  tying the fix to the existing skip is acceptable if un-skipping is out of
  scope.
- `endManifestWorkers`'s new token does not match `spawnLive`'s wrapper
  command line — assert this directly if practical, or reason it in the
  comment the way the surrounding file already does (dense inline comments
  explaining *why*, not just *what*).
- `workerstate.test.mjs`'s `idle` spawn gains `detached: true`; the existing
  assertions in that test (`activity(idle.pid)` reads `idle`, the two differ)
  keep passing.

Plus the repo's gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the changed-file-scoped `node --test` run for
`test/reconcile/*.test.mjs` and the gate scripts it lists. The suites named
under `CI suites` in `## Plot Config` (including `test:e2e` and
`test:contracts`) run in CI on the PR; do not run them locally as a matter of
course — `test:contracts` alone needs more than ten minutes, and `test:e2e`
dispatches real workers into sandbox repos and is CI's gate, not a local one.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not
apply.

### Bookkeeping

Open the PR through the controller once the branch has its first real
commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, or
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to
this branch's line in the plan's `## Slices` section, under "Group signal
after exit".

### Scope guard

This branch owns:
- `test/reconcile/own-process.mjs`
- `test/reconcile/workerloop.test.mjs`
- `test/reconcile/restart.test.mjs`
- `test/reconcile/workerstate.test.mjs`

No other branch in this plan's seven remaining slices touches these files —
the plan's Design section states slices change disjoint file sets except the
two decision-gate slices ("Decision table reading" and "Bundle declaration
pairing"), which are unrelated to this one. The next slice in document order,
"Board test signals" (`bug/the-board-tests-signal-only-their-own-process`),
depends on `signalOwn`'s group-signal fix landing here first, since it moves
board/e2e kill sites onto this same helper.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
