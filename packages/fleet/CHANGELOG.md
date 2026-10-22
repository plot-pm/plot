# @plot-pm/fleet

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
