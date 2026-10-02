# A shared account names what spends it

> Every Plot process on one computer already sees a shared Bitbucket workspace's whole rate, and only the board's PR refresh slows down for it. On 2026-10-01 the account ran at 3363-3515 requests an hour and the listing endpoint answered 429 for about 100 minutes. This plan measures which callers spend that rate outside the cadence rule, and brings the largest one under that rule only if the measurement names it.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Started:** 2026-10-02, Jan Wloka, `bug/the-largest-caller-follows-the-account-rate`
- **Type:** bug
- **Issue:** #1069
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The Plot caller that spends most of a shared host account outside the board's cadence slows down when the account is over its share. If the measurement finds no such caller, nothing changes and #1069 closes on the measurement.

Board impact: the board's fleet scan is a candidate caller (`fleet.ts:3655`). No payload or schema change is planned; slice 2 states one if its caller needs it.

## Motivation

### What Plot already sees, read on `origin/main` (`acf700c1`)

- **The spend record is per computer, not per checkout.** `budget_path` writes `$HOME/.plot/state/budget.tsv` unless `PLOT_BUDGET_HOME` is set (`skills/plot/scripts/plot-budget.sh:73-80`).
- **A Bitbucket account is the workspace.** `budget_account` reads the owner from `remote.origin.url` (`skills/plot/scripts/plot-host.sh:2800-2806`): *"two checkouts of one workspace share a budget."*
- **The board's PR refresh slows for every other spender.** `prRefreshMsFor` (`packages/board/src/server/fleet.ts:1844-1851`) calls `refreshIntervalMs`, which subtracts the board's own share from the account's rate (`othersPerHour`, `packages/domain/src/rules/cadence.ts:97`) and stretches up to `MAX_CADENCE_STRETCH = 8` (`cadence.ts:32`).
- **The supervisor prints the account's rate beside its own share.** `account=<n>/hr mine=<n>/hr` (`packages/board/src/server/entry/registryd.ts:384-389`), where `mine` is `boardSharePerHour` (`registryd-main.ts:320`).

So the issue's title, *"Plot has no view of it"*, is false for a second checkout on the same computer. The record holds its calls, and the board slows for them. A checkout on another computer writes to another record, and no local reading can see it.

### What does not slow down

- **The fleet scan runs on the pulse, not on the cadence.** The board schedules it every `REFRESH_MS = 5_000` (`fleet.ts:118`, `:3655`), and each run makes two listing calls: `pr-list --state open --rich` (`skills/plot/scripts/plot-fleet-scan.sh:882`) and `pr-list --state all` (`:898`). Only the `pr-reader` beat (`fleet.ts:3658`) uses `prRefreshMsFor`.
- **The board's full PR read** is the subject of `a-pr-refresh-reads-the-history-once-a-day` (#1087). This plan does not touch it.
- **The supervisor's merge lookups** read the PR index first and are bounded since #1140 (`packages/board/src/server/queue-reading.ts:236`, `:306`).

### Measured 2026-10-01 on Plot 2.22.1, from #1069

The supervisor read `account=3363/hr mine=1140/hr`, then `account=3515/hr mine=1200/hr`. The process list at that time held two boards, two supervisors, two fleet scans and an interactive session, across two checkouts of one workspace. The listing endpoint answered 429 from about 12:30 to after 14:10, and the board reported *"Fleet scan blind: the git host refused a burst"*.

No reading has split that rate by caller. The record has no caller field, and the panel showed that adding one breaks every reader: `plot-budget.sh:607` is `if (NF != 10 || $1 != "b1") { unreadable++; next }`.

## Design

### The rule

**No caller changes until a measurement on `origin/main` names which caller spends the account outside the cadence rule, and how much.**

### Slice 1 measures

On a computer where two checkouts of one Bitbucket workspace run their boards and supervisors, the measurement puts a `bb` wrapper first on `PATH` for those processes, in a scratch directory. The wrapper logs the time, the `bb` arguments and the parent's command line, then runs the real `bb`. Nothing is committed and no shipped file changes; the spend record keeps its ten fields.

It runs for one hour and reports, per checkout and per caller (board PR refresh, board fleet scan, supervisor, other), the requests an hour, each as a share of the account's total. It compares that total with `plot-host.sh spend-rate` for the same account and window, so the wrapper is shown to count what the record counts. It posts the table on #1069 and records it in Notes, with the commit and the Plot version.

### Slice 2 acts only on a named caller

Slice 2 runs if slice 1 finds that callers outside the cadence rule spend **50% or more** of the account's requests, and one of them spends more than the others. It brings that one caller under the account's rate:

- **The decision goes into the domain.** Whether a caller may spend a listing now is a rule in `packages/domain/src/rules/`, built on `cadence.ts` (`othersPerHour`, `targetStretch`) rather than beside it. The caller reads the account's rate through the existing `spend-rate` reading and asks the rule; it keeps no second copy of the arithmetic.
- **A caller that may not spend reuses its last answer and says so.** For the fleet scan that is its last listing, reported as older than the pulse, never as a fresh one and never as an empty one.
- **The board's own PR refresh does not change.** It already follows the rule.

If slice 1 finds no such caller, slice 2 is deferred with the measurement as its reason. #1069 then closes with the table and with the statement that two checkouts of one workspace share one account by design.

### What this does NOT do

- **It does not add a field to the spend record.** The panel showed that `plot-budget.sh:607` and `decodeEntry` both refuse an eleventh field.
- **It does not share one PR cache between checkouts.** Two checkouts of different repositories list different pull requests, so a cache per account would not remove a request between them. The proposal in #1069's 2026-10-01 comment is answered by this measurement, not built.
- **It does not see another computer's spend.** The record is local.
- **It adds no `plot-*.sh` script.**

## Done when

- Slice 1: a table on #1069 gives one hour of requests per checkout and per caller for one shared Bitbucket workspace, its total agrees with `spend-rate` for the same window within 10%, and the largest caller outside the cadence rule is named.
- Slice 2, if it runs: the named caller asks a domain rule before it spends, asserted in a domain test that an account over its share defers the call and an account under it allows it. A second one-hour reading at comparable load shows that caller's requests an hour fall, recorded in the PR.
- Slice 2, if deferred: its branch line carries `deferred:` with the measurement, and #1069 is closed with the same table.

## Slices

### The account's spend is attributed by caller (Branch: bug/the-account-spend-is-attributed-by-caller, PR: #1190)

One hour of `bb` calls counted per checkout and per caller through a `PATH` wrapper in a scratch directory, compared with `spend-rate`, posted on #1069. No shipped file changes. <!-- builds: a per-caller attribution of one shared account's requests -->

### The largest caller follows the account rate (Branch: bug/the-largest-caller-follows-the-account-rate, PR: #1200) <!-- waits: bug/the-account-spend-is-attributed-by-caller -->

The caller slice 1 names asks a domain rule built on `cadence.ts` before it spends, and reuses its last answer while the account is over its share; deferred if slice 1 names no caller holding the share. <!-- builds: a domain rule deciding whether a listing may spend now -->

## Notes

- **Replaces the rejected `a-spend-line-names-its-caller`** (`docs/plans/2026-09-29-a-spend-line-names-its-caller.md`). That plan proposed a caller field in the spend record. The panel found that the account field already names the workspace, that the board's cadence already reads the whole account, and that an eleventh field makes every line unreadable. This plan keeps the record unchanged, measures per caller outside it, and makes the change conditional on that measurement.
- The 3363-3515 requests an hour are one supervisor's reading on Plot 2.22.1. The supervisor's merge lookups changed after that reading (#1140), so the split on `origin/main` may differ.
- **Measured 2026-10-02, 06:30:00-07:30:00 UTC, on the Bitbucket workspace `quatico`** (slice 1). Two checkouts of `quatico/ewz-kus-portal`: C1 is the main checkout, and C2 is a linked worktree outside it, detached at `origin/develop`. Each checkout ran one board (`board-server.mjs`, ports 7778 and 7779) and one supervisor (`plot-registryd.mjs` in the foreground, without `--start-agents` and `--sweep-temp`). Supervisor choice: no launchd unit was loaded or unloaded, and both supervisors ran in the foreground under the wrapped `PATH`. All four processes ran the installed plugin, Plot 2.22.2 at `573f2af7`. That commit is an ancestor of `origin/main` `2ce8007f`, and the 27 commits between them change only issue listing among the measured paths, which this workspace does not reach (`Tracker: plot`). No process had `PLOT_BUDGET_HOME` set. The checkout is the caller's working directory. The caller is the first named process in its ancestor chain.

  | Caller | Under the cadence rule | C1 /hr | C2 /hr | Total /hr | Share | Network /hr | Network share |
  |---|---|---|---|---|---|---|---|
  | Board fleet scan | no | 1438 | 1511 | 2949 | 93.6% | 2168 | 97.1% |
  | Supervisor | no | 92 | 92 | 184 | 5.8% | 60 | 2.7% |
  | Board PR refresh | yes | 8 | 9 | 17 | 0.5% | 5 | 0.2% |
  | Other | no | 0 | 0 | 0 | 0.0% | 0 | 0.0% |
  | **Total** | | **1538** | **1612** | **3150** | 100% | **2233** | 100% |

  `plot-host.sh spend-rate --connector bitbucket --account quatico` read at 07:30:01 UTC: `spent=3134`, `perHour=3134.17`, `unreadable=0`. The record holds 3134 lines in the window, and the wrapper logged 3150 calls: a difference of 0.5%. The wrapper logs a call when it starts and the record logs it when it ends, so calls in flight at the window's edges explain the difference. "Network" excludes `bb --version` and `bb pr list --help --json`, which make no request but are recorded as spends: 917 of 3150 calls, 29%.

  **Verdict for slice 2: the condition holds.** Callers outside the cadence rule spend 3133 of 3150 calls, 99.5%. The largest is the **board fleet scan**, with 93.6% of all calls and 97.1% of network calls. Slice 2 brings the board fleet scan under the account's rate.

  Not anticipated by the plan: the fleet scan's open listing makes one request per branch, not one per run. Its `pr-list --state open --rich --branch …` sent 1764 `pullrequests?q=state="OPEN" AND source.branch.name=…` requests in the hour, against 276 `pr list --state open` and 128 `pr list --state merged` listings.
