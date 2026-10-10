# The tests and gates close their review findings

> Eight review follow-up issues name 24 findings against the decision gate, the reap entry, two shell answers, the kill and continue tests, the install-hooks verify and the own-process helper; 23 still hold on `origin/main` at `c9d63311d`, and eight slices close them.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-gates-and-the-review-findings
- **Issue:** #1412, #1415, #1433, #1434, #1461, #1473, #1485, #1489
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1495 merged
- **Started:** 2026-10-10, Jan Wloka, `bug/a-gone-leader-still-ends-its-group`

## Changelog

- The decision gate normalises the case of a Kind cell, names a kind it does not know, refuses a row whose cell count differs from the header's, and says "N scripts are not launchers".
- The decision gate pairs an `entryPoints` path and an `outfile` only inside one `esbuild.build({ … })` call, and accepts a declared bundle only when `build.mjs` also copies it to `skills/plot/scripts/board/`.
- The reap entry counts a dirty desk with the same filter that the reap loop uses, and sweeps `/tmp` when `TMPDIR` is empty.
- `plot-pr-merged.sh` no longer defines `pr_merged_heads`; `plot-host.sh pr-merged-heads` is the one answer to "which heads merged".
- `plot-install-hooks.sh --verify` gives the raw exit code of a gate that ended with 128 or more twice.

<!-- Board impact: none. No slice changes the plan format, the template or the docs/plans layout. Slice "Reaper readings" changes packages/board/src/server/entry/reap.ts, so main rebuilds board/plot-reap.mjs after its merge; the PR carries no bundle. -->

## Motivation

Eight reviews between 2026-10-08 and 2026-10-10 merged their PRs with findings below HIGH and filed them as issues. Each finding is small, and each one is a place where a gate reads the wrong thing or a test fails for a reason other than a defect. Measured on `origin/main` at `c9d63311d` (2026-10-10):

| Issue | Findings | Still hold | Code |
|---|---|---|---|
| #1412 | 4 LOW + 1 comment | 5 | `scripts/check-decision-count.sh`, `scripts/check-shell-lines.sh` |
| #1415 | 2 MEDIUM + missing tests | 3 | `scripts/check-decision-count.sh` (`read_declared`) |
| #1433 | 1 MEDIUM + 2 LOW | 2 | `packages/board/src/server/entry/reap.ts` |
| #1434 | 1 | 1 | `skills/plot/scripts/plot-pr-merged.sh`, `plot-host.sh` |
| #1461 | 2 MEDIUM + 1 LOW | 3 | `packages/domain/test/run-script.test.ts` |
| #1473 | 2 LOW | 2 | `packages/board/test/unit/continue-route.test.ts` |
| #1485 | 2 LOW | 2 | `skills/plot/scripts/plot-install-hooks.sh`, its test |
| #1489 | 1 MEDIUM + 4 LOW | 5 | `test/reconcile/own-process.mjs` and six test files |

### Findings that still hold

**#1412, the decision gate (`scripts/check-decision-count.sh`):**

- `counted` (`:176`) and the evidence filter (`:190`) compare the Kind cell with lowercase literals. A row spelled `Launcher` counts as a decision and fails with "more than at merge base", which names neither the row nor the spelling.
- `rows` reads Kind, Runs and Replaced by from the end of the row (`:85`, `$(NF - 3)` and `$(NF - 1)`) and never compares the row's cell count with the header's. A row with a missing or extra cell shifts the Kind column.
- `push` mode fails with "is not a commit in this clone" when the `before` SHA is absent (`:220`), which a force-push causes. `scripts/check-shell-lines.sh:111` has the same line.
- `report` prints "$after scripts still decide or orchestrate now" (`:184`): "1 scripts", and since #1416 (`43bb972f8`) the count is "not a launcher", which includes `readings` and `paired` rows that neither decide nor orchestrate.

**#1415, bundle declarations (`read_declared`, `scripts/check-decision-count.sh:106-129`):**

- `entry` carries forward until the next line that matches `out_re` (`:119-123`). An `outfile:` that is not a bare identifier does not reset it, so the next call's `outfile` can pair with the previous call's entry. The patterns match by line shape (`:112-115`) and not inside an `esbuild.build({` block, so a matching line inside a template literal reads as a declaration.
- A `shipped*` const, a `dist/` const and an entry/outfile pair are enough. `build.mjs` copies each bundle with `fs.copyFileSync(<dist>, <shipped>)` (for example `:158`, `:186`, `:212`), and the gate does not read that line, so a dead declaration passes.
- `test/reconcile/decision-count.test.mjs` has no test for a non-declaration line that contains `dist/x.mjs`, and none for entry/outfile pairing across two calls.

**#1433, the reap entry (`packages/board/src/server/entry/reap.ts`):**

- MEDIUM: the dirty-tree kind reads `ctx.trees.dirtyPaths` (`:1013`), which is the worker-record and editor-leftover filter (`packages/domain/src/ports/trees.ts:99`). The shell it replaced read `desk_dirt` (`plot-reap.sh:1216` at `58a886039^`), which the reap loop at `:619` reads as `dirtyPathsWithStatus` (`trees.ts:117`). The two kinds now use two filters, and no test covers the dirty-tree population.
- LOW: `--sweep-temp` takes `process.env.TMPDIR ?? '/tmp'` (`:404`), so `TMPDIR=''` gives the root `''`, where the shell used `${TMPDIR:-/tmp}`. `ownedByMe` (`:420-427`) answers true when `USER` and `LOGNAME` are unset or `stat` throws, where the shell used `find -user "$me"`.

**#1434, two answers to "which heads merged":** `plot-host.sh pr-merged-heads` (`:3813-3860`) is the answer that `Host.prMergedHeads` reads (`reap.ts:336`). `pr_merged_heads` in `plot-pr-merged.sh:211-223` answers the same question with its own `gh` call. Since #1432 made `plot-reap.sh` a 13-line launcher, no script calls `pr_merged_heads`: `git grep` finds it only in its own file, in comments, and in two assertions in `test/reconcile/host.test.mjs` (`:6427-6429`, `:6455-6457`). No corpus test under `packages/domain/corpus/` holds the pair.

**#1461, kill-test timing (`packages/domain/test/run-script.test.ts`):**

- M1: "sends KILL to a child that ignores TERM after its leader exited on TERM" (`:206-226`) and "sends KILL to a group that ignores TERM once the grace has passed" (`:228-235`) sleep 200 ms and assume `sh` has installed `trap "" TERM` by then.
- M2: "lets a timed-out script remove the temp paths it registered" (`:250-269`) assumes bash sources `plot-tmp.sh` and echoes the directory within its 1 s timeout; an empty stdout makes `work.startsWith` throw a TypeError.
- L1: `gone()` (`:180-184`) polls for up to 10 s, and `packages/domain/vitest.config.ts` sets no `testTimeout`, so vitest's 5 s default ends the test first and its `finally` does not run.

**#1473, the continue test's worker wait (`packages/board/test/unit/continue-route.test.ts`):**

- L1: `settle` reads `.plot-worker.pid` with no guard (`:197`), and the root `afterEach` (`:220-226`) calls `rmTree(dir)` after `settle` with no `finally`, so an ENOENT leaks the desk.
- L2: a non-numeric pid gives `NaN`, and `settle` returns without waiting (`:198`).

**#1485, the crashed-gate verify wording (`skills/plot/scripts/plot-install-hooks.sh`):**

- L1: `drive_gate` (`:275-280`) reads every exit of 128 or more as "ended by a signal", and the report line (`:417`) says "a signal ended the gate twice" for a gate that ran `exit 255` itself.
- L2: `test/reconcile/install-hooks.test.mjs` has no test for a signal on the first probe and a permit on the second, and `signalStub` (`:561`) records no working directory, so no test proves that the retry runs in a new scratch repository.

**#1489, own-process follow-ups:**

- M1: `signalOwn` (`test/reconcile/own-process.mjs:97-106`) checks the group leader with `isOwn` before it signals the group, so a gone leader sends nothing. `endDesk` (`test/reconcile/dispatch.test.mjs:3436-3456`) then leaves `plot-agent-monitor.sh` running in the group while the test removes the desk.
- L1: `sleepCount` (`test/reconcile/workerloop.test.mjs:275-282`) counts `sleep <secs>` machine-wide with `pgrep`, and the pre-test `reap(secs)` calls (`:303`, `:346`, `:379`, `:414`) clear nothing because `ownGroups` is empty before the test's own `runLoop`. These tests are skipped today (`:45`).
- L2: `endManifestWorkers` (`test/reconcile/restart.test.mjs:228-234`) matches `command: 'sleep 300'`, which the wrapper's `sh -c` script also contains.
- L3: `workerstate.test.mjs:708` spawns `idle` without `detached: true`, so `process.kill(-idle.pid, …)` at `:724` signals no group and the `sleep 30` grandchild survives `idle.kill`.
- L4: board and e2e tests kill pids read from files or recorded by hand: `packages/board/test/unit/board-run.test.ts:239`, `interrogate-route.test.ts:307`, `continue-route.test.ts:209` and `:1367`, `packages/board/test/lifetime.test.mjs:111`, `test/e2e/monitors-end.test.mjs:289-321` and `:384`, `test/e2e/worker-loop-manifest.test.mjs:228`.

### Findings dropped as fixed

- **#1433 LOW, `hasPr` passed as `branch !== ''`.** The review read the branch head. The squash merge `58a886039` (#1432) passes `false` (`reap.ts:277`, `processes.workerState(worktree, false)`), which is what the shell passed. Nothing remains to change.

## Design

### Approach

Each slice changes one group of files, and no two slices change the same file. The slices are in document order, so a slice is eligible after the slice above it merges. Two slices change `scripts/check-decision-count.sh`, and they are adjacent. Slice "Group signal after exit" comes before slice "Board test signals", because the second one moves board and e2e tests to the helper that the first one changes.

**Decision table reading (#1412).** `rows` lowercases the Kind cell before it compares it. A Kind that is none of the known kinds fails and names the row and the kind. `rows` reads the header's cell count and refuses a row whose count differs. For an absent `before` SHA, both `check-decision-count.sh` and `check-shell-lines.sh` run `git fetch --no-tags origin <sha>` once; when the SHA is still absent, they compare with `HEAD^1` and print that the range starts at the first parent because `<sha>` is not in the clone. The report reads "N scripts are not launchers now, M at <base>". Tests go into `decision-count.test.mjs` and `shell-lines.test.mjs`.

**Bundle declaration pairing (#1415).** `read_declared` opens a call on a line that matches `esbuild.build({` and closes it on the matching `});`. It records `entryPoints` and `outfile` only inside an open call and resets both at the call's start and end. A bundle counts only when `build.mjs` also holds `fs.copyFileSync(<distvar>, <shippedvar>)` for its two consts. The slice adds the two tests the review names and a test for a matching line inside a template literal. The slice runs the parser under BSD awk and gawk, and states mawk as unconfirmed unless it runs mawk.

**Reaper readings (#1433).** The dirty-tree kind reads `dirtyPathsWithStatus`, as the reap loop does, and strips the status code before it counts. A unit test holds a desk whose only dirt is a path that `desk_dirt` excuses and `plot_worker_dirty` does not, and asserts that the dirty-tree kind does not report it. `--sweep-temp` treats an empty `TMPDIR` as unset. `ownedByMe` answers false when `stat` throws, and answers by uid alone, because `process.getuid()` needs no `USER`.

**Merged heads answer (#1434).** The slice removes `pr_merged_heads` from `plot-pr-merged.sh`, its two assertions in `host.test.mjs`, and its name from the file header (`:5`) and the comment block above it (`:200-210`). The issue accepts removal as done, and removal ends the duplicate, so no corpus pair is needed. Removal also lowers the shipped shell line count that `check-shell-lines.sh` measures.

**Kill test readiness (#1461).** Each child that installs a trap prints a readiness line after the `trap`, and the test waits for that line before it signals. The temp-path test waits for its `echo` line before the timeout can matter, by a readiness line or a larger timeout. `gone()` polls for less than the test's timeout, or the two tests set an explicit timeout above 10 s; the slice picks one and names it.

**Group signal after exit (#1489 M1, L1–L3).** `signalOwn` with `group: true` signals the group when no process holds the leader's pid (`identityOf(n) === null`), because a pgid is not given out again while any member lives. `own-process.test.mjs` holds that case. `sleepCount` counts only inside `ownGroups`. `endManifestWorkers` matches a token unique to the fixture. `idle` spawns with `detached: true`.

**Board test signals (#1473, #1489 L4).** `settle` catches the pid read, fails naming the file on a non-numeric pid, and the root `afterEach` runs `rmTree` in a `finally`. The board and e2e kill sites listed above move to `signalOwn` from `test/reconcile/own-process.mjs`. The slice does not run `test:e2e` locally; CI runs it on the PR.

**Gate exit wording (#1485).** The `unverified` line gives the raw exit code, for example "exited 255 twice (128 or more)". `signalStub` gets a variant that exits 0 on its second run, and records `pwd` so a test asserts that the two runs used different directories. `plot-install-hooks.sh` is under `skills/`, so the wording change must not raise the shipped shell line count.

**Off-limits files.** Plan `the-gates-are-launchers` converts the PreToolUse gate scripts (`skills/plot/scripts/plot-*-gate.sh`) in the same sprint. No slice here changes any `plot-*-gate.sh` file.

**Shell and domain.** No slice adds a shell rule that the domain also holds. Slice "Merged heads answer" removes a declared-nowhere duplicate instead of pairing it.

**Changesets.** A slice that changes shipped code (`reap.ts`, `plot-pr-merged.sh`, `plot-install-hooks.sh`) carries a `plot` patch changeset with the description first. A slice that changes only tests or `scripts/` carries none.

### Open Questions

- [ ] Absent `before` SHA: is `HEAD^1` the right fallback after a failed fetch, or must the push run report "not measured" and pass? `HEAD^1` measures only the last commit of a force-pushed range.
- [ ] Does `the-gates-are-launchers` change `plot-install-hooks.sh` or `test/reconcile/install-hooks.test.mjs`? Slice "Gate exit wording" is last so that it can rebase onto that plan's slices if they do.
- [ ] Does `the-gates-are-launchers` flip README rows to `launcher` before slice "Decision table reading" merges? Case normalisation accepts those rows either way, but an unknown kind now fails, so a row spelled outside the four kinds fails there.
- [ ] Slices touch disjoint files except the two decision-gate slices, so six could run at once. Plan ordering is positional, so they run one after another. Is that acceptable for this sprint, or does the sprint want a second plan for the test-only slices?

## Slices

### Group signal after exit

- `bug/a-gone-leader-still-ends-its-group` → #1511 — `signalOwn` signals the group of a gone leader, `sleepCount` counts only its own groups, `endManifestWorkers` matches a fixture token, and `idle` leads its own group (issue 1489) <!-- builds: group signal for a gone leader in own-process.mjs -->

### Board test signals

- `bug/the-board-tests-signal-only-their-own-process` — `settle` guards its pid read and the `afterEach` removes the desk in a `finally`; the board and e2e kill sites use `signalOwn` (issue 1473, issue 1489) <!-- builds: own-process signals in the board and e2e tests -->

### Kill test readiness

- `bug/the-kill-tests-wait-for-readiness` — the TERM-trap tests wait for a readiness line, the temp-path test waits for its directory line, and `gone()` fits inside the test timeout (issue 1461) <!-- builds: readiness lines in run-script.test.ts -->

### Reaper readings

- `bug/the-reaper-reads-what-the-shell-read` — the dirty-tree kind uses the reap loop's dirt filter, an empty `TMPDIR` sweeps `/tmp`, and ownership reads the uid alone (issue 1433) <!-- builds: desk_dirt filter for the dirty-tree kind in reap.ts -->

### Merged heads answer

- `bug/one-answer-to-which-heads-merged` — `pr_merged_heads` leaves `plot-pr-merged.sh`, so `plot-host.sh pr-merged-heads` is the only answer (issue 1434) <!-- builds: removal of pr_merged_heads -->

### Decision table reading

- `bug/the-decision-gate-reads-its-table-strictly` — Kind case is normalised and an unknown kind is named, a row with the wrong cell count fails, an absent `before` SHA is fetched or replaced by the first parent, and the report says "not launchers" (issue 1412) <!-- builds: strict table reading in check-decision-count.sh -->

### Bundle declaration pairing

- `bug/a-bundle-declaration-is-one-build-call` — `read_declared` pairs entry and outfile inside one `esbuild.build` call and requires the `copyFileSync` line (issue 1415) <!-- builds: per-call declaration parsing in check-decision-count.sh -->

### Gate exit wording

- `bug/a-gate-exit-names-its-code` — the `unverified` line gives the raw exit code, and two retry outcomes get tests (issue 1485) <!-- builds: exit-code wording in plot-install-hooks.sh -->

## Notes

- Verified 2026-10-10 against `origin/main` at `c9d63311d`. Line numbers above are from that commit.
- `packages/board/src/server/fleet.ts:886` `runStreaming` sends SIGKILL to the leader only (#1461, "out of scope, noted"). Its only callers are tests, and no slice here changes it.
- The e2e kill sites in slice "Board test signals" are proved by CI's `test:e2e` run on the PR, not by a local run.
- Manifesto checklist: the plan keeps planning in git, adds no project-specific assumption, adds no configuration, and adds no ceremony. Each slice closes named findings in code that exists, and slice "Merged heads answer" removes code.
