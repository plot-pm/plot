# @plot-pm/fleet

## 0.1.3

### Patch Changes

- [#2511](https://github.com/plot-pm/plot/pull/2511) [`31bcf15`](https://github.com/plot-pm/plot/commit/31bcf15d14e4ecc2e3704e81f2c3e61ca29c806c) Thanks [@jwloka](https://github.com/jwloka)! - `continueOnDesk` reads `Slice max runs` through the same digits-only grammar the worker loop's own `positive`/`count` use, rather than a bare `Number()` that also accepted `1e1` and `0x5` as real limits. `Slice max spend` now reads as a three-way `unset`/`value`/`unreadable` result, matching the loop's `dollarsOrUnset`, so a present-but-malformed spend limit refuses the continuation instead of running unlimited. A `write`-path continuation (no manifest yet names the desk) now seeds `sliceRuns: 1` on the manifest it writes, so it counts as a run the next continuation reads — it previously read back as `0` forever and never hit `Slice max runs`.

  <!--
  plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
  bumps:
    skills:
      plot: patch
  -->

- [#2590](https://github.com/plot-pm/plot/pull/2590) [`d968655`](https://github.com/plot-pm/plot/commit/d96865523bf1548a385ce4411cfacaf133e5e78b) Thanks [@jwloka](https://github.com/jwloka)! - `continueOnDesk` restores the desk's manifest when the loop stop or the wrapper stop fails, and removes `.plot-continuation.md` on every `failed` return after it wrote the prompt. It signals the manifest's `wrapperPid` only after the process table shows that pid as an ancestor of the free-waiting loop, which also holds after a hop moved the desk to another worktree; a pid that is no ancestor of the loop is refused as `loop-alive` before any signal, with the desk as found. `ProcessProbe` gains `parentPid(pid)`, read from `ps -o ppid=`.

  <!--
  plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
  bumps:
    skills:
      plot: patch
  -->

- [#2587](https://github.com/plot-pm/plot/pull/2587) [`a278fce`](https://github.com/plot-pm/plot/commit/a278fce10383897477c50ea38f1e4ab4dcd0c02a) Thanks [@jwloka](https://github.com/jwloka)! - A slice's draft PR now leaves draft on its own once the agent finishes and checks pass, instead of staying draft forever once CI goes green with no agent left to flip it. `markReadyDecision` (`@plot-pm/domain`'s `rules/mark-ready.ts`) answers `true` only for a `finished` worker on an open, draft PR whose head still matches the agent's last push; every other worker state, a closed or already-ready PR, a moved head, or an unreadable draft flag answers `false`. `agentLoop`'s row 13 reads the PR's draft flag and head sha from the same `WaitClock` reading already taken on entry to the checks wait — never a fresh host call for the decision — and emits the existing `pr-ready` write, which `performLoopWrites` applies through a new `Host.prReady` port method (`host-shell.ts` calling `plot-host.sh pr-ready`, never `gh` directly). A refused `pr-ready` call is recorded and logged; it does not join the take-up sequence, so it cannot stop a later write or change the pass's exit code.

  <!--
  plan: docs/plans/2026-10-24-a-slice-pr-left-as-a.md
  bumps:
    skills:
      plot: patch
  -->

- [#2673](https://github.com/plot-pm/plot/pull/2673) [`41b0937`](https://github.com/plot-pm/plot/commit/41b09372e1c5a4c7ab21b7b05ecad589faf0da0b) Thanks [@jwloka](https://github.com/jwloka)! - `registryd-main.ts`'s default-branch tick now warns once per distinct cause instead of repeating the same line every tick: a lasting read failure previously filled the fleetd log with one identical warning per interval forever. A changed line — a new cause, or the reading recovering to no warning at all — still prints.

  <!--
  plan: docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md
  bumps:
    skills:
      plot: patch
  -->

- [#2627](https://github.com/plot-pm/plot/pull/2627) [`2923f1e`](https://github.com/plot-pm/plot/commit/2923f1e1710b8428aae9be80d7ac5ecddc79476f) Thanks [@jwloka](https://github.com/jwloka)! - Continuation tests now assert the specific refusal or ending reason their name states, rather than bare truthiness, and new coverage closes three gaps: an unreadable `.plot-worker.ending.json` refuses `no-manifest` on `/api/continue`, `continueTarget` accepts a `write` fallback for the `spend-limit`, `run-limit` and `checks-unanswered` endings, and `correctionHasContinuation` is proven to skip an identical second answer within one slice rather than only its file-read mechanics.

  <!--
  plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
  -->

- [#2564](https://github.com/plot-pm/plot/pull/2564) [`a94a7ab`](https://github.com/plot-pm/plot/commit/a94a7ab52ddc3bcb0a2650b232dd3084cce432d3) Thanks [@jwloka](https://github.com/jwloka)! - Bounded the two ways `scaleUp` could hold a scale-up slot forever ([#2486](https://github.com/plot-pm/plot/issues/2486)). A `--start` launch with no recorded pid yet now counts for only `launchGraceMs` (30 s) past its own `startedAt`, not `Worker bound`'s 8 h — a launch whose agent never starts now frees its slot within the daemon's own tick rather than holding it for a working day. A launch WITH a stamped, live pid now ages out too, through a new `Launched pid bound` `## Plot Config` key (default 28800 s): a reused pid left in an old manifest no longer inflates the running count forever. `launchedUnregisteredCount` moved from the fleet package into `@plot-pm/domain`'s `rules/queue.ts` as a pure function taking `alive` and `now` as readings, and `queue-reading.ts`'s `readQueue` now requires its caller to supply `alive` explicitly rather than defaulting to the real process table.

  <!--
  plan: docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md
  bumps:
    skills:
      plot: patch
  -->

- [#2538](https://github.com/plot-pm/plot/pull/2538) [`f2bc395`](https://github.com/plot-pm/plot/commit/f2bc395ac79e61c72fed506cf8ca65367da46021) Thanks [@jwloka](https://github.com/jwloka)! - `startImplement` captures the main checkout's branch before running `/plot-implement` and restores it once the run ends — on success, on a failed run, and on the `IMPLEMENT_TIMEOUT_MS` bound kill alike. A checkout left on a slice branch by a prior `/api/implement` run, as happened on 2026-10-20, previously stayed there until a person intervened; a second run could then commit its own brief onto that stranded branch. The restore reads and checks out the branch through two new `Trees` port methods, `currentBranchSync` and `checkoutSync`, rather than calling `git` directly from `packages/fleet/src/shared/implement-run.ts` — the direct calls tripped CI's "One place reaches a process" ratchet, which only adapter code may cross.

  <!--
  plan: docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md
  bumps:
    skills:
      plot: patch
      plot-implement: patch
  -->

- [#2695](https://github.com/plot-pm/plot/pull/2695) [`aec640f`](https://github.com/plot-pm/plot/commit/aec640f4ab69951f5fad35a9e659d9051dccf0cc) Thanks [@jwloka](https://github.com/jwloka)! - `remoteSlug` (`remote-slug.ts`), `ownerOfRemote` (`remote-owner.ts`) and `branchUrlBase` (`@plot-pm/fleet`'s `fleet-scan.ts`) each carried their own regex for splitting a git remote URL into host and path, and the three disagreed on `file://` URLs and single-character scp-style hosts (a Windows drive letter). They now share one parser, `hostAndPathOfRemote` (`packages/domain/src/rules/remote-url.ts`); `branchUrlBase` keeps its Bitbucket-host allowlist and GitHub/Bitbucket URL-template logic, calling the shared parser only for the host/path split. `same-commit.corpus.test.ts` now spawns the real `plot-host.sh pr-merge --match-head` against a stub `bb` instead of comparing `sameCommit` to an inline copy of its pin-match expression, closing the gap `docs/shell-and-domain.md` exists to prevent — two of its original cases passed an empty `--match-head` value, which the shell's own argument parsing refuses before the comparison runs, so their coverage moved to `same-commit.test.ts` as plain unit cases. `.changeset/changelog-functions.js` wraps `@changesets/changelog-github`'s `getReleaseLine`/`getDependencyReleaseLine` so a backtick-quoted issue reference in a changeset summary (`` `#2065` ``) stays literal text instead of being rewritten into a markdown link.

  <!--
  plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
  bumps:
    skills:
      plot: patch
  -->

- Updated dependencies [[`d968655`](https://github.com/plot-pm/plot/commit/d96865523bf1548a385ce4411cfacaf133e5e78b), [`a278fce`](https://github.com/plot-pm/plot/commit/a278fce10383897477c50ea38f1e4ab4dcd0c02a), [`2923f1e`](https://github.com/plot-pm/plot/commit/2923f1e1710b8428aae9be80d7ac5ecddc79476f), [`d3f5baf`](https://github.com/plot-pm/plot/commit/d3f5baf02be9ad0aaeb6b700a23c2a208fa75fa2), [`a94a7ab`](https://github.com/plot-pm/plot/commit/a94a7ab52ddc3bcb0a2650b232dd3084cce432d3), [`f2bc395`](https://github.com/plot-pm/plot/commit/f2bc395ac79e61c72fed506cf8ca65367da46021), [`aec640f`](https://github.com/plot-pm/plot/commit/aec640f4ab69951f5fad35a9e659d9051dccf0cc), [`541a2cf`](https://github.com/plot-pm/plot/commit/541a2cfd297f0501f3095a37022393cabba67770)]:
  - @plot-pm/domain@0.3.4

## 0.1.2

### Patch Changes

- [#1935](https://github.com/plot-pm/plot/pull/1935) [`bc6c683`](https://github.com/plot-pm/plot/commit/bc6c683ff641eef810a5dc75f470247967b2282a) Thanks [@jwloka](https://github.com/jwloka)! - `refreshIssueIndex` no longer writes a closed, inbox or open read's `unsupported` answer onto `state.issueError` — only a genuine `failed` read does. A connector with no closed-issue listing (Bitbucket) or no person-scoped inbox read reported that structural absence as an ongoing error on every single pass; it is now a standing fact the index already carries under `closed.answer`/`answer`, never surfaced as a failure.

  <!--
  plan: docs/plans/2026-10-16-jira-inbox-and-issue-index.md
  bumps:
    skills:
      plot: patch
  -->

- [#1892](https://github.com/plot-pm/plot/pull/1892) [`350eb98`](https://github.com/plot-pm/plot/commit/350eb982025d5bacd63aa8daeac8542d50486ef6) Thanks [@jwloka](https://github.com/jwloka)! - `scanOnce` now keeps the `terminal:`/`listing:` lines a scan killed at `FLEET_SCAN_BUDGET_MS` already streamed, instead of discarding them with the thrown error, fixing [#1756](https://github.com/plot-pm/plot/issues/1756). A killed scan merges its streamed terminal rows into `state.terminal` by branch name, and replaces `state.listing` only where the streamed listing ends with `.list-arrived`, which `plot-fleet-scan.sh` now prints after every listing row. A listing cut short by a kill is not adopted and is not carried, so a missing branch never reads as `NONE`. A completed scan replaces both caches as before.

  <!--
  plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
  bumps:
    skills:
      plot: patch
  -->

- [#1924](https://github.com/plot-pm/plot/pull/1924) [`6001faf`](https://github.com/plot-pm/plot/commit/6001faf51732911c0158417bf1772fcfe6e14e20) Thanks [@jwloka](https://github.com/jwloka)! - `IssueIndex.at` is now optional rather than a required string, and a failed issue-index pass with no held index of the same source and connector now writes no `at` at all instead of inventing one from the failed read's own timestamp — fixing [#1845](https://github.com/plot-pm/plot/issues/1845)/finding [#1652](https://github.com/plot-pm/plot/issues/1652). A failed pass still carries the held `at` forward unchanged where the held index answered the same source and connector and itself carried one. Separately, `registryd-main.ts`'s git-host probe now warns and names the failure before assuming `github`, instead of falling back silently and corrupting downstream cadence/connector tracking on a repository whose host probe fails.

  <!--
  plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
  bumps:
    skills:
      plot: patch
  -->

- Updated dependencies [[`9d04661`](https://github.com/plot-pm/plot/commit/9d04661ed5068f723da54508b4327f450350c087), [`880fbca`](https://github.com/plot-pm/plot/commit/880fbca4dcf8230f446c80df13bb9db627d456d4), [`f50e12d`](https://github.com/plot-pm/plot/commit/f50e12d243eaaa870f52b4171955c0c88659613e), [`b2dc829`](https://github.com/plot-pm/plot/commit/b2dc829a3276306e7933060e75538e60d58f9c42), [`a7483a1`](https://github.com/plot-pm/plot/commit/a7483a144bb6b0067f7eaca191c39b04d322a5f9), [`1faa7da`](https://github.com/plot-pm/plot/commit/1faa7da9b7e7a01f81ae7846179294950ae243f5), [`6001faf`](https://github.com/plot-pm/plot/commit/6001faf51732911c0158417bf1772fcfe6e14e20), [`a1a5549`](https://github.com/plot-pm/plot/commit/a1a554974962b62e538dc3a4f74db561f1149f1a)]:
  - @plot-pm/domain@0.3.3

## 0.1.1

### Patch Changes

- Updated dependencies [[`ed42e43`](https://github.com/plot-pm/plot/commit/ed42e43593dcf93976b6826e1154f0b7d5085f42)]:
  - @plot-pm/domain@0.3.2
