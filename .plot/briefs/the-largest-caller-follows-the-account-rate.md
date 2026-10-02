## Implementation brief — a-shared-account-names-what-spends-it (wave 2: The largest caller follows the account rate)

- **Plan (canonical):** `docs/plans/2026-10-01-a-shared-account-names-what-spends-it.md` on `main`
- **Issue:** #1069
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-largest-caller-follows-the-account-rate` (base: `main`)
- **Ends as:** one PR to `main`. Open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- **Review of the code:** per repo convention. A person reviews the PR.

This slice waits on `bug/the-account-spend-is-attributed-by-caller` (PR #1190, merged). That slice's table is in the plan's `## Notes`, and it names the caller this slice changes.

### What to build

Issue #1069: on 2026-10-01 one Bitbucket workspace spent 3363-3515 requests an hour and its listing endpoint answered 429 for about 100 minutes. Slice 1 measured the split on 2026-10-02 (Plot 2.22.2, two checkouts of `quatico/ewz-kus-portal`, one hour). Callers outside the cadence rule spent 3133 of 3150 calls, 99.5%. The **board fleet scan** spent 2949 calls, 93.6% of all calls and 97.1% of network calls. The board's PR refresh, which already follows the cadence, spent 17 calls, 0.5%.

The fleet scan runs on the 5 s pulse (`REFRESH_MS`, `packages/board/src/server/fleet.ts:121`, the `fleet-scan` divisor in `boardDivisors`). It does not call `prRefreshMsFor`. Each run asks the host for open and all PRs (`plot-fleet-scan.sh:898` and `:914`). On Bitbucket the adapter sweeps one REST request per tracked branch per state, so the open listing alone sent 1764 requests in the hour, against 276 `pr list --state open` and 128 `pr list --state merged` listings. The plan did not anticipate this per-branch shape. Cutting the number of scan runs does not fix it. Cutting the host requests a run makes does.

Build this: a rule in `packages/domain/src/rules/` that answers whether the fleet scan may spend a PR listing now. It builds on `cadence.ts` (`othersPerHour`, `targetStretch`, `refreshIntervalMs`) and keeps no second copy of the arithmetic. The board reads the account's rate through `spendRateFor` (`fleet.ts:1907`, one local `spend-rate` read that spends no request) and asks the rule. When the rule says no, the scan reuses its last listing. The pulse and the git work stay on the 5 s beat. Only the host listing slows.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The decision lives in the domain, and the caller keeps no arithmetic.** `refreshIntervalMs` already turns a rate into an interval for one spender. The new rule reuses it. A second stretch formula in `fleet.ts` or in shell is the defect `docs/shell-and-domain.md` names. The board is the caller, so no `plot-*.sh` script is added (the plan's "does NOT do" list).

**A caller that may not spend reuses its last answer and says so.** The reused listing is reported as older than the pulse. It is never reported as fresh and never as empty. Absent is not false: an empty listing reads as "no PRs" and refused four fully-merged plans on 2026-08-27 (see `plot-impl-status.sh` in `CLAUDE.md`). The scan's `host=` footer word and `PLOT_TERMINAL_CACHE`'s licence (`fleet.ts:3380`) are the existing vocabulary. Reuse them before you coin a word.

**The first reading has no previous listing.** A board that has not yet listed has nothing to reuse. The rule allows the call then. Slowing before the first answer would leave the board blind.

**The stretch is bounded.** `MAX_CADENCE_STRETCH = 8` and `CADENCE_DAMPING = 0.25` in `cadence.ts` exist because an unbounded stretch loops: a spender that stops spending has no fresh reading to come back on. Their measurements stand. The scan inherits both bounds. It does not get a ceiling of its own.

**The board's own PR refresh does not change.** It carries 17 calls an hour and already follows the rule.

**It does not add a field to the spend record.** `plot-budget.sh:607` and `decodeEntry` refuse an eleventh field. It does not share one PR cache between checkouts, because two checkouts of different repositories list different pull requests. It does not see another computer's spend, because the record is local.

**Where the reuse happens is the open choice, and the plan leaves it to you.** The scan is a stateless shell script and the board holds the previous pulse in `entry`. Two seams exist: the board hands the scan an environment variable the way it hands `PLOT_TERMINAL_CACHE` (`fleet.ts:3380`), or the board answers from its own held listing without spawning the host call. Pick the one that leaves the `--stream` terminal line and the scan's footer true. State your choice and its reason in the PR. Measure the request count before and after on a fixture, or say that you could not.

**Rules carried over unchanged.** Absent is not zero: an unreadable `spend-rate` is `null`, and `null` leaves the cadence where it is (`spendRateFor`). Read the exit code, not the emptiness: `plot-host.sh` exit 4 and exit 0 with no output are different answers. A GitHub board is unchanged. The multiplier is 1 there, and the rule must return the same listing cadence it returns today.

### Done when

The plan's `## Done when`, slice 2 case, is the specification. The named caller asks a domain rule before it spends. A domain test asserts that an account over its share defers the call and an account under it allows it. A second one-hour reading at comparable load shows the fleet scan's requests an hour fall, recorded in the PR.

Assertions that exist because a naive implementation would pass without them:

- **A deferred call returns the previous listing marked as older, not an empty one.** A rule test that only checks the boolean passes while the board shows every PR as missing. Assert the reused payload and its age.
- **The first call with no previous listing is allowed.** This catches a rule that defers on a cold start.
- **A `null` rate allows the call.** This catches silence read as a busy account.
- **A GitHub fixture sees the same number of host calls as before.** This catches a rule that slows the common case to protect the uncommon one.

The second reading needs a Bitbucket estate with two checkouts of one workspace, which this repository (GitHub) cannot supply. If none is available, write `PLOT-BLOCKED` naming what is missing. Do not simulate an hour with a stub. The domain test and the code can still land in the PR, and the PR says the reading is outstanding.

Plus the repo gates: add a changeset with `'@plot-pm/board': patch` for the board code (the domain package ships through the board bundle, so check `scripts/check-changeset-packages.sh`), and run `pnpm build:board` if you touch anything under `packages/board/src` that the artifact bundles, because a stale `board-server.mjs` fails CI. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

New functions in `packages/domain/src/` are arrow functions with factual TSDoc: what it does, its parameters, what it returns. The reasoning goes in the commit message.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Then add `, PR: #<number>` inside the slice heading: `(Branch: bug/the-largest-caller-follows-the-account-rate, PR: #<number>)`. The arrow form after the heading parses as no PR.
- Post the second reading on #1069 when it exists. Plot closes no issue, so the operator closes it.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new rule and its test, beside `cadence.ts`), the fleet-scan call site in `packages/board/src/server/fleet.ts`, and `skills/plot/scripts/plot-fleet-scan.sh` only if you choose the environment-variable seam.

In flight, verified against `origin/main...origin/<branch>` on 2026-10-02:

- `bug/the-scan-drops-its-largest-cost` (PR #1196, plan `a-scan-says-where-its-time-goes`) edits `skills/plot/scripts/plot-fleet-scan.sh` (75 lines), `plot-host.sh` (43 lines), `test/reconcile/fleet.test.mjs` and `host.test.mjs`. It removes a cost from the same scan. If you take the environment-variable seam, expect a conflict in `plot-fleet-scan.sh` and `fleet.test.mjs`. Rebase onto it after it merges, and do not copy its hunks. If it has not merged when you reach the shell edit, prefer the board-side seam.
- `bug/the-queue-reads-the-scans-order`, `bug/a-held-slice-names-the-unanswered-landing` and `bug/a-worker-less-checkout-yields-its-branch` touch `queue-reading.ts`, `registryd*.ts`, `queue.ts`, `checkout-yield` and `plot-worker-loop.sh`. None holds `cadence.ts` or `fleet.ts`. `board-server.mjs` is generated and marked `-merge`: on a conflict take either side and run `pnpm build:board`.

`a-pr-refresh-reads-the-history-once-a-day` (#1087) owns the board's full PR read. Do not touch it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
