# Juror verdict — lens: estate

Position: amend

The defect is real and larger than the plan shows: the master agent's own entry point, `plot-ask.mjs board`, loses 89 % of its answer through a pipe today. The plan's counts of lines are right, but its classification and its "26 entries" are wrong, and the approach as written ("replace the ending `process.exit(code)` with `process.exitCode = code`") breaks four exits that are not endings. All code citations are from `p2748-main` at `32f0c8cd6`.

## Census

### Bundle entries (read)

- `packages/board/build.mjs` builds 55 bundles: `src/server/index.ts` (`board-server.mjs`) and 54 entries under `src/server/entry/`. `packages/fleet/build.mjs` builds 7, all under `src/server/entry/`. Total 62 bundles, 61 entry-dir bundles.
- 10 files under `packages/board/src/server/entry/` are not bundle entries: `act`, `ask`, `estate-fingerprint`, `host-pin`, `ladder`, `merge`, `plan-lookup`, `plangate`, `pr-index-lookup-answer`, `stack-readings`. 2 fleet files are not entries: `loop-writes`, `registryd`. Note `entry/main.ts` builds `plot-ask.mjs`, not a file called `ask`.
- 2 entry bundles already end correctly: `listing-walk.ts:79` (`da194bcaf`) and `registryd-main.ts:2914` (`plot-fleetd.mjs`, sets `exitCode` on the success path). The other 59 entry bundles call `process.exit(`.

### `process.exit(` lines in `packages/*/src/server/entry/` (read, counted by grep)

66 lines in 59 files: 60 board lines in 53 files, 6 fleet lines in 6 files. This matches the plan's 60 + 6. Classification:

| Class | Count | Sites |
|---|---|---|
| Signal handler | 0 | none in `entry/` |
| Early refusal, nothing on stdout (usage text on stderr, literal code) | 4 | `plan-for-branch.ts:47`, `transition.ts:364`, `review-bypass.ts:148`, `local-checks.ts:222` |
| After the answer, but NOT the last statement (control flow) | 4 | `transition.ts:352` (`if (check !== -1) process.exit(checkSlices(...))`), `local-checks.ts:214`, `:217`, `:219` |
| Terminal, after the answer, synchronous `run` | 35 | `standing:115`, `issue-source:118`, `sprint-score:140`, `reconcile:435`, `panel:259`, `start-command:76`, `prompt-exit:161`, `branch-state:326`, `propose-stack:98`, `agent-state:179`, `delta:287`, `slice-chain:92`, `verdicts:239`, `plan-undeliver:190`, `release-gate:364`, `landed:124`, `bitbucket-mergeable:71`, `slice-pr:226`, `claim-answer:73`, `checkout-yield:98`, `adopt:215`, `old-label:78`, `transition:368`, `bitbucket-slug:32`, `movable:114`, `merge-subject:396`, `jenkins-pr-checks:135`, `desk-root:72`, `sprint-transition:320`, `empty-claim:87`, `agent-settings:93`, `task:110`, fleet `fleet-size:147`, `prompt:240`, `desk-loop:86` |
| Terminal, after the answer, awaited `run` / `.then` | 23 | `issue-status:203`, `main:249` (`.then`), `deliver:981`, `sprint-release-gate:405`, `pr-index-lookup:158`, `verify:932`, `pr-state:59`, `release-chain:205`, `gate:794`, `plan-for-branch:50`, `review:682`, `needs-design:548`, `reap:1178`, `plan-state:212`, `design:339`, `brief-book:249`, `slice-spend:187`, `review-bypass:152`, `approve:1314`, `record-pr:200`, fleet `dispatch-command:225`, `continue-command:116`, `worker-loop:2598` |

4 + 4 + 35 + 23 = 66. The plan copies the issue's "19 + 7" and names 7 awaited entries; the tree holds 23 awaited endings (26 counting the three awaited `local-checks` lines). The plan's sentence "the fix is the same for all 26" names neither count.

### `process.exit(` outside `entry/` (read)

`board/src/server/index.ts:1020` and `lifetime.ts:104,201` (board server lifetime), `fleet/src/shared/board-run.ts:72`, `domain/src/adapters/agent-run/agent-run-sdk.ts:318`, `domain/src/adapters/bounded-run/bounded-run-process.ts:82` (signal handlers), `board/build.mjs:29,127` (build script). None of them sits on an entry's answer path. So the plan's first Open Question resolves: no helper an entry calls exits after a write, and a scan of `entry/` alone covers the estate today.

### Who parses each entry's stdout (read, grep for the bundle name outside tests and `docs/`)

Shell callers that capture stdout: `plot-host.sh` (bitbucket-mergeable, bitbucket-slug, issue-source, jenkins-pr-checks, listing-walk, release-chain, reap), `plot-reconcile-scan.sh` (issue-source, pr-index-lookup, release-chain, review-bypass, slice-chain, reconcile), `plot-fleet-scan.sh` (branch-state, delta, merge-subject, verdicts), `plot-dispatch.sh` (prompt, claim-answer, fleet-size, desk-loop, movable, start-command, ask `plangate`), `plot-open-pr.sh` (plan-for-branch, slice-pr), `plot-impl-status.sh` (pr-index-lookup, pr-state), `plot-board-probe.sh` (pr-index-lookup, propose-stack), `plot-sprint-release.sh` (sprint-score, sprint-release-gate), `plot-worker-state.sh` (task, desk-loop), `plot-pr-merged.sh` (landed), `plot-deliverable-search.sh` (delta), and one each for adopt, agent-settings, desk-root, empty-claim, issue-status, old-label, plan-state, plan-undeliver, record-pr, release-gate, sprint-transition, standing, approve, deliver. TS callers (board/fleetd via adapters): agent-state, checkout-yield, design, verify, needs-design, transition, verdicts, desk-root, desk-loop, local-checks. No caller found by name for brief-book, continue-command, panel, prompt-exit, review, slice-spend (operator- or agent-run from skills).

### Which entries write over 64 KB (ran)

On this Mac, from `/Users/jwloka/Quatico/Agentic-Tools/plot`:

- `plot-ask.mjs board`: 595,679 bytes to a file, **65,536** through a pipe (two runs).
- `plot-ask.mjs fleet`: 149,909 bytes to a file, **65,536** through a pipe (two runs).

The Claude Code Bash tool reads through a pipe: my own `plot-ask.mjs board` call returned 64.1 KB. So every master-agent session that asks `board` or `fleet` reads a truncated JSON document today. The plan does not name `plot-ask.mjs` at all; it is the largest and most-read victim. Other entries whose output scales with the estate (not run): `reconcile`, `verdicts`, `branch-state`, `merge-subject`, `pr-index-lookup`, `issue-source`, `release-chain`, `review-bypass`, `local-checks`.

## Rubric

1. **The problem.** 58 terminal exits and 4 control-flow exits follow an answer; 2 bundles are measured over 64 KB (`plot-ask board`, `plot-ask fleet`), both read by agents through a pipe. Handles: `plot-ask.mjs` ends on its own with `exitCode` (ran: a preload that turns `process.exit` into `exitCode =` delivered 595,679 and 149,907 bytes and exited 0 in 18 s and 15 s). `plot-worker-loop.mjs --self-check` also ends on its own (ran, 1 s). Not traced, and the plan must trace them before changing them: `worker-loop.ts:2598` (agent SDK children, stdout goes to a log file through `exec`, so it gains nothing from the change), `dispatch-command.ts:225` (spawns through `detachedNode`, which `unref`s, read only), `continue-command.ts:116`, `verify.ts`, `design.ts`, `needs-design.ts` (launch agents).
2. **The approach.** "Set `exitCode` and return" is wrong for 4 sites: top-level module code has no `return`, so `transition.ts:352` would fall through into `run(...)` at `:368` and write a second answer, and `local-checks.ts:217` would fall through to the usage error at `:221-222` and overwrite a 0 with `EXIT.usage`. These need an `if/else` chain. The 4 early refusals write only short stderr and can stay or become `exitCode` inside the same chain. The "shared ending if three or more need close-then-set" condition is vacuous on this census: zero measured entries need a close; the two that ran end on their own. Drop the conditional `builds:` or state it as "if the handle trace finds three".
3. **Safety.** Hang paths: an entry that leaves a ref'd timer, socket or child after its answer now waits for it instead of being killed. Candidates are the six untraced entries above. Exit code paths: the 4 control-flow sites above. Signal handlers: none in `entry/`, so none breaks. stderr is also asynchronous to a pipe on macOS; the plan only names stdout.
4. **The gate.** A grep cannot tell "after a stdout write": in every terminal case the write happens inside `run` through a callback, so a file-level "write before exit" test flags all 59 files and the distinction is empty. The honest gate is "no `process.exit(` under `packages/*/src/server/entry/`", zero allowed, after slice 1 also rewrites the 4 early refusals as `exitCode` in an `else` chain. That grep is exact, bash 3.2 safe, and lives in `scripts/` (not shipped, so `check-shell-lines.sh` does not count it). It may also be a `test/reconcile/*gate*.test.mjs` file, which `Local checks` already runs for `**`. Slice 2 can exist, but it is small enough to ship in slice 1's PR, where the tree first passes it.
5. **Slices and acceptance.** Slice 1's acceptance ("one test through an asynchronous stdout stub") is checkable on both platforms, and I proved the mechanism (ran): a preload that defers `process.stdout.write` through `setImmediate`, with stdout to a **file**, gave 0 bytes from today's `plot-ask.mjs fleet` and 149,909 bytes with `exitCode`. A file is synchronous on Linux too, so the test fails on Linux CI with the old code. Name `plot-ask.mjs` as the test subject. The Changelog line is observable; it should name `plot-ask.mjs board`/`fleet` as the measured case.

## Amendments

1. Replace "19 + 7" and "all 26" with the census: 66 lines, 4 early refusals, 4 control-flow exits, 58 terminal endings (35 sync, 23 awaited).
2. Name the 4 control-flow sites (`transition.ts:352`, `local-checks.ts:214,217,219`) and require an `if/else` rewrite there, not a substitution.
3. Name `plot-ask.mjs` (`entry/main.ts:249`) as the measured victim (595,679 → 65,536 bytes) and make it the acceptance test's subject, driven through an async-stdout preload with output to a file.
4. Trace or exclude `worker-loop`, `dispatch-command`, `continue-command`, `verify`, `design`, `needs-design` before changing their ending; `worker-loop` writes to a log file and can keep `process.exit`.
5. Make the gate "zero `process.exit(` in `entry/`" with no "after a write" heuristic; drop the conditional shared-ending `builds:` or tie it to the trace.
