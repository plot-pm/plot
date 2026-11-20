# Plot's Bitbucket requests share one hourly budget with bb

> Plot predicts 800 Bitbucket requests an hour, fleetd's in-process client counts its requests in `bb`'s per-account ledger and stops while `bb`'s pause holds, and `plot-host.sh` reads `bb rate-limit --json`, maps `bb`'s exit 75 to the throttled exit and drops the craftamap capability probe.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- Plot predicts 800 Bitbucket requests an hour where no `Host rate limit` is declared, the ceiling that `bb` keeps. A workspace or repository access token with a scaled limit declares its own number in `Host rate limit`.
- fleetd's Bitbucket requests count in the same per-account ledger as `bb`'s own requests. fleetd sends no request while `bb` is paused after a rate limit, and a rate limit that fleetd receives pauses every `bb` process of that account on the machine.
- The Bitbucket limit reading names how many requests remain in the last hour on this machine, where it named none before.
- A `bb` command that `bb` refuses with exit 75 reaches Plot as throttled, so callers wait instead of reporting a failure.

<!-- Board impact: no plan format, template or docs/plans layout change. Two helper scripts change: `plot-host.sh` (the `limit` op's Bitbucket line gains `remaining` and `reset`, exit 75 maps to exit 5, the `--json` probe goes) and nothing else under skills/plot/scripts/. The board reads `LimitReading` unchanged; a Bitbucket reading that carried `remaining: null` now carries a number, so the board's headroom and "rate limit" readings show for Bitbucket where they showed unknown. No board bundle is committed (`scripts/check-no-bundle-diff.sh`). -->

## Motivation

Bitbucket Cloud allows 1,000 repository-data requests per rolling hour per user for a user API token, and the bitbucket.org website in that user's browser spends from the same budget. A 429 for a user API token carries no `Retry-After` and no `X-RateLimit-*` headers (quatico-solutions/agent-skills PR #133, merged 2026-11-20T17:40:59Z, body section *Why*). One runaway caller can therefore lock its owner out of the website for hours.

`bb` now keeps the budget for every caller on a machine (agent-skills PR #133, released in v3.22.0 on 2026-11-20 as `bb` 1.15.0, `cli/bb:5`). It records each request per account and per UTC hour, refuses above 800 requests in the last 3,600 s with exit 75 (`BB_BUDGET_DEFAULT=800`, `cli/bb:225`), and after a 429 pauses every `bb` process of the account for 300 s, doubling to 3,600 s (`bb_pause_after_429`, `cli/bb:530`).

Plot does not take part in that budget, in three ways:

- **The prediction is 12.5 times too high for a user token.** `DEFAULT_PREDICTED_HOST_LIMIT = 10_000` (`packages/domain/src/rules/declared-host-limit.ts:5`), and the shell predicts the same 10000 (`skills/plot/scripts/plot-host.sh:3683`). PR #3579 chose 10000 as "Atlassian's scaled cap" (`plot-config.sh:233-237`). Atlassian documents that cap only for workspace, project and repository access tokens and Forge `asApp` requests; a user API token stays at 1,000 (PR #3579 body, *Atlassian's documentation*).
- **fleetd's requests are invisible to `bb`.** Since `bitbucket-and-jira-read-in-process`, fleetd reads Bitbucket over Node HTTPS (`packages/domain/src/adapters/host/bitbucket-api.ts`). Its requests are not in `bb`'s ledger, so `bb` admits 800 more requests while fleetd spends from the same 1,000. fleetd also ignores `bb`'s pause file, and a 429 that fleetd receives starts no pause for `bb`.
- **`plot-host.sh` reads `bb`'s exit 75 as a failure in most ops.** `host_failure_kind` (`plot-host.sh:799`) maps the words "rate limited" to `throttled`, but only `pr_list_failed` turns that into exit 5 (`plot-host.sh:878`). The other Bitbucket ops pass the error to `die3` (`plot-host.sh:704`), and `refusalKindOfExit` (`packages/domain/src/adapters/host/host-shell.ts:199`) reads exit 3 as `failed`. A caller then counsels looking instead of waiting.

Operator decision, 2026-11-20: the Bitbucket default prediction is 800 an hour, the same as `bb`'s ceiling, and `Host rate limit` stays the override (for example 10000 for an access token with a scaled limit).

## Design

### Approach

**The `bb` formats this plan reads and writes.** Read from `cli/bb` at agent-skills `2c904ab17` (release v3.22.0). Every slice treats these as `bb`'s contract and changes none of them.

- **State directory** (`bb_state_path`, `cli/bb:295`; `bb_state_dir`, `cli/bb:312`): `$BB_STATE_DIR`, else `$XDG_STATE_HOME/bb`, else `$HOME/.local/state/bb`. An empty variable counts as unset. A missing directory is created with mode 700. An existing directory is used as it is if it is writable and searchable.
- **Account key** (`bb_account_key`, `cli/bb:335`): the first 12 hex characters of the SHA-256 of the lowercased email. `bb` takes the email from `BB_EMAIL`, else from the keychain.
- **Request file:** `requests-<key>-<YYYYMMDDHH>.log`, one file per UTC hour. Each request appends one line: the epoch second in decimal digits and `\n` (`bb_request_guard`, `cli/bb:607`). `bb` appends before it sends, so a request that Bitbucket answers with 429 counts. A request that `bb` refuses does not count.
- **Count** (`bb_budget_count`, `cli/bb:376`): lines of the previous and the current hour's files that are all digits, at most 12 characters, later than `now - 3600` and not later than `now`. At the ceiling `c`, the next free second is the `(n - c + 1)`-th oldest counted line plus 3600. A missing file holds no request. A file that exists and cannot be read makes the count unknown.
- **Prune** (`bb_budget_prune`, `cli/bb:399`): each guarded request deletes the request files of every account whose hour stamp is older than the previous hour. A file that stays does no harm.
- **Pause file** (`bb_pause_read`, `cli/bb:428`): `pause-<key>`, one line `<end epoch> <length s>\n`. It is valid only as exactly two whole numbers of at most 12 digits, leading zeros not counted, with a length above 0. Anything else is no pause.
- **Stale pause** (`bb_pause_is_stale`, `cli/bb:452`): a pause with more than its length plus `BB_PAUSE_SKEW=5` s left (`cli/bb:228`) counts as no pause.
- **Pause after a 429** (`bb_pause_after_429`, `cli/bb:530`): with no stored pause, or one that ended 3,600 s ago or longer, the length is 300 s. One that ended less than 3,600 s ago doubles its length, at most 3,600 s. A numeric `Retry-After` raises the length to at least its value. The end is `now + length`. A pause that is still active keeps the later of its end and `now + Retry-After` (300 s without one), and the larger length.
- **Pause write** (`bb_pause_write`, `cli/bb:488`): the line goes to `pause-<key>.XXXXXX` in the same directory and is renamed into place. Just before the rename the writer reads the stored pause again and keeps a later, non-stale end and the larger length, so parallel 429s cannot shorten a pause.
- **Ceiling** (`bb_hourly_limit`, `cli/bb:355`): `BB_HOURLY_LIMIT`, else 800; `0` turns the ceiling off and still records; more than 9 digits reads as 999999999; any other value exits 1.
- **Fail open:** an unusable state directory, an unreadable request file, a garbage line, a line from the future and a stale pause never block a request. `bb` warns once per process and sends.
- **`bb rate-limit --json`** (`cmd_rate_limit`, `cli/bb:3228`): prints `{requests, ceiling, paused_until, wait_seconds}` and sends nothing. `requests` is null where the count is unknown, `ceiling` is null with the ceiling off, `paused_until` is epoch seconds or null, and `wait_seconds` is 0 when a request can go out now. It exits 75 during a pause or at the ceiling and 0 otherwise.

**Measured on this machine, 2026-11-20:** `/opt/homebrew/bin/bb` reports `bb 1.13.0` and answers `bb rate-limit --json` with `unknown command: rate-limit` and exit 1. A `bb` older than 1.15.0 is therefore the normal case until the tap update reaches every machine, and slice 3 keeps the prediction for it.

**Slice 1, the default.** `DEFAULT_PREDICTED_HOST_LIMIT` becomes 800, and `budget_reading`'s Bitbucket arm (`plot-host.sh:3683`) prints 800 where the key is unset or does not read as a limit. `corpus/declared-host-limit.corpus.test.ts` keeps holding `declaredHostLimit` and the shell to one answer; its assertion `toContain('10000')` (`:64`) still holds through the `'10000'` case, and the empty case now answers 800 on both sides. Every comment and doc that names 10000 as the default changes: `bitbucket-api.ts:84` and `:165`, `plot-host.sh:3668` and `:5928`, `plot-config.sh:233-237`, and the test names in `packages/domain/test/bitbucket-api.test.ts:272` and `:286`. `Host rate limit` keeps its meaning and precedence: `X-RateLimit-Limit` on a reply, then the key, then 800.

**Slice 2, one ledger.** The in-process client takes part in `bb`'s budget as one more `bb` caller.

- **Before each request**, the client reads the pause file of its account key. While a non-stale pause is active it sends nothing and answers `throttled` with `waitMs` set to the pause's end minus now. Next it counts the last 3,600 s; at the ceiling it sends nothing and answers `throttled` with `waitMs` set to the next free second minus now. Otherwise it appends one line to the current hour's request file, prunes as `bb` does, and sends. A refused request must append no line to either ledger, so the guard runs before `connectorHttps.exchange` takes a slot and records a `BudgetEntry`.
- **After a 429**, the client writes or extends the pause with `bb`'s rule and `bb`'s merge-before-rename, and its `throttled` refusal carries the stored pause's end as `waitMs`. The refusal keeps `throttledOf`'s kind and words (`connector-https.ts:126`).
- **The limit it records.** `spend` (`bitbucket-api.ts`) records basis `predicted` with `limit` = the ceiling and `remaining` = the ceiling minus the requests counted after this one, floored at 0, where the count is known. `resetAt` is the next free second at the ceiling, else null. A reply with a numeric `X-RateLimit-Limit` keeps basis `actual`, as PR #3579 settled.
- **The account key.** `bb`'s ledger is keyed by the user, because Bitbucket's limit is per user. The client computes the key from the email it already resolved (`BB_EMAIL` from the environment or `.env`, `bitbucket-api.ts`), so fleetd and `bb` meet in one file when both read the same email. Plot's own `budget_account` for Bitbucket stays the workspace (`rules/bitbucket-budget-account.ts`, `plot-host.sh:3580`): it keys Plot's `budget.tsv`, a different ledger, and this plan changes neither key. Where the client's email differs from the keychain email that `bb` reads, the two write two ledgers; the slice logs the key it writes so a person can compare it with `bb rate-limit`.
- **Concurrency.** A request line is at most 13 bytes, below `PIPE_BUF` (512 bytes on macOS, 4,096 on Linux), and goes out as one `O_APPEND` write, so parallel writers in fleetd and in `bb` never interleave a line. The pause file is replaced by a rename only. There is no lock, as in `bb`: parallel callers can pass the ceiling by a few requests, and the 200 requests between 800 and 1,000 absorb that.
- **Fail open, as `bb` does.** An unusable state directory, an unreadable request file, a failed append or a failed pause write sends the request with no budget and logs one warning per process. A stale or garbage pause file is no pause.
- **Ceiling source.** The client reads `BB_HOURLY_LIMIT` with `bb`'s rule where fleetd's environment sets it, else the declared host limit (800 after slice 1). See Open Questions.

**The layering decision for slice 2: a domain rule plus an adapter.** The format and every verdict are rules, and the file IO is an adapter, because *The Layering Rule* says no domain behaviour lives outside the domain and the purity gate (`.github/workflows/ci.yml:1673`) lets the domain import only `zod`. So `packages/domain/src/rules/bb-ledger.ts` holds pure functions over values: the hour stamps of a second, the count and next free second over the two files' text, the pause parsed from its text, the stale test, the pause after a 429 from the stored pause, the merge before the rename, and the guard's verdict (`send`, `paused`, `ceiling`). `packages/domain/src/adapters/host/bb-ledger-file.ts` resolves the state directory from the environment, computes the account key with `node:crypto`, reads, appends, prunes and renames. `bitbucketApi` takes it as one more seam with a production default, the way it takes `budget` and `slots` (`bitbucket-api.ts:74-77`). It is not a new port: the ledger is reached only by an adapter, and the domain decides from the readings it is given, which is the *readings as values* shape of the layering rule. The precedent is `jenkins-api.ts`, which reads and writes `jen`'s token store under `JEN_CONFIG_DIR` with a temp file and a rename (`jenkins-api.ts:225-319`).

**The rule is a declared duplicate of `bb`'s, and joins the corpus tier.** `bb` is the other implementation, so *A Shell Script Asks The Domain* applies. A recorder, `packages/domain/corpus/record-bb-ledger.mjs`, refuses any `bb` that does not report the version it was written against, lifts `bb_hour_stamps`, `bb_budget_count`, `bb_pause_read`, `bb_pause_is_stale` and `bb_pause_after_429` out of `cli/bb` with `awk`, runs them on fixed inputs with `BB_NOW`, and writes `fixtures/bb-ledger/`. `bb-ledger.corpus.test.ts` holds `rules/bb-ledger.ts` to those answers. `record-jenkins-reads.mjs` and `jen-url.corpus.test.ts` are the same shape for `jen`. The corpus runs with no `bb` installed, so CI needs none.

**Slice 3, the shell.**

- **Exit 75 is throttled.** Every Bitbucket op whose `bb` call exits 75 exits 5, so `refusalKindOfExit` answers `throttled` (`host-shell.ts:200`). The mapping is made in one place that every Bitbucket error path passes; `die3` is the candidate, since the `bb()` wrapper (`plot-host.sh:3957`) runs inside command substitutions whose variables do not reach the parent. A test drives one op through each path with a stub `bb` that exits 75.
- **The limit reads `bb`.** The `limit` op's Bitbucket arm (`plot-host.sh:5926-5935`) runs `bb rate-limit --json`, which sends no request. On exit 0 or 75 with valid JSON, it prints `limit` = the smaller of `ceiling` and the declared limit (the declared limit where `ceiling` is null), `remaining` = that limit minus `requests`, floored at 0, `reset` = now plus `wait_seconds` where it is above 0, else null, and basis `predicted`. On any other answer, including bb 1.13.0's `unknown command: rate-limit` with exit 1, it prints today's line: the declared limit, `remaining: null`, `reset: null`. `budget_reading` stays a free prediction with no `bb` call, because the `bb()` wrapper calls it after every request (`plot-host.sh:3731`) and a second process per request is the cost `budget_reading`'s comment refuses.
- **The craftamap probe goes.** `bb_identify`, `bb_test_json_support`, `bb_require_json` and `BB_CAP_*` (`plot-host.sh:2767-2919`) exist only to detect craftamap/bb, and Plot now supports only Quatico `bb`. Their 8 call sites on `47cb74ef2` go (PR #3589's body counts 12 with comments). `bb_list_page_length` (`plot-host.sh:3336`) reads the version that `bb_require_json` recorded; it reads one cached `bb --version` instead, which sends no request, and keeps `BB_LIST_PAGE_VERSIONS` (`plot-host.sh:3331`) and its twin in `adapters/host/listing-paging.ts:16`. `PLOT_BB_SKIP_CAP_CHECK` goes from the 17 lines under `test/` and `packages/` that name it, and the request-budget test that counts the probe's two `bb` calls counts zero.
- **The shell-lines ratchet.** `scripts/check-shell-lines.sh pr` must read lower after this slice than at its merge base: the probe block is 153 lines of `plot-host.sh` (`:2767-2919`), and the exit mapping and the `rate-limit` read add a few dozen.

### Open Questions

- [ ] **Which ceiling the in-process client applies.** Recommended: `BB_HOURLY_LIMIT` where fleetd's environment sets it, else the declared host limit. The alternative is the declared limit only. With the recommendation, an operator who raises `Host rate limit` to 10000 for a scaled token and leaves `BB_HOURLY_LIMIT` unset gets 10000 in fleetd and 800 in `bb`, over one ledger; with the alternative, a `BB_HOURLY_LIMIT` that the person set for the machine does not bind fleetd.
- [ ] **A `bb` call that `bb` refused still writes a row to Plot's `budget.tsv`.** The `bb()` wrapper records a call for every exit (`plot-host.sh:3957-3963`), and exit 75 is both "sent and refused with 429" and "never sent". Recommended: leave it out of this plan and file it as an issue; the over-count is one row per refused call, and splitting the two cases needs `bb`'s stderr, which the wrapper does not see.

## Slices

### Default prediction

- `bug/bitbucket-predicts-800-an-hour` — `DEFAULT_PREDICTED_HOST_LIMIT` and `budget_reading`'s Bitbucket arm answer 800, the corpus pair agrees, and every comment and doc that names 10000 as the default changes <!-- builds: DEFAULT_PREDICTED_HOST_LIMIT 800, the Bitbucket default prediction -->

### Shared ledger

- `bug/fleetd-counts-in-the-bb-ledger` <!-- waits: bug/bitbucket-predicts-800-an-hour --> — fleetd's in-process client appends each request to `bb`'s per-account ledger, sends nothing while `bb`'s pause holds, writes the pause after a 429 with `bb`'s rule, and records `remaining` from the ledger; tests run with a temp `BB_STATE_DIR` <!-- builds: rules/bb-ledger.ts and adapters/host/bb-ledger-file.ts, the bb ledger rule and its file adapter -->

### Shell reading

- `bug/plot-host-reads-bb-rate-limit` <!-- waits: bug/fleetd-counts-in-the-bb-ledger --> — starts on a `main` that holds PR #3589; `plot-host.sh` maps `bb` exit 75 to exit 5, the `limit` op reads `bb rate-limit --json` where `bb` answers it, and the craftamap `--json` probe goes, with a net reduction on the shell-lines ratchet <!-- builds: the bb rate-limit reading in plot-host.sh limit -->

## Notes

- **Why 10000 is wrong for a user token.** PR #3579 measured, on 2026-11-20 10:46 UTC, that an authenticated `GET /2.0/repositories/quatico/ewz-kus-portal/pullrequests?pagelen=1` with a user API token carries no header matching `/ratelimit/i`. So the key and the default are what take effect. Atlassian's 10,000 is the scaled cap for access tokens and Forge `asApp` requests; for a user token the limit is 1,000 an hour, shared with the website. A prediction of 10000 tells every pacing reader that 9,000 more requests are free when none are.
- **Why 800 and not 1,000.** The website in the user's browser spends from the same 1,000, and parallel callers with no lock can pass a ceiling by a few requests. `bb` keeps 200 below the host's limit for both reasons (agent-skills PR #133, *Design notes*), and one number for both clients keeps one ledger meaningful.
- **What the ledger does not cover.** It counts one machine. Two machines of one user, and the website, still spend unseen; a 429 is still the only signal for them, and the pause is still the reaction.
- **Slice 3 starts after PR #3589 merges.** PR #3589 (`experiment/bitbucket-has-no-issues`) is open on 2026-11-20. A `waits:` annotation cannot name it: on a draft of this plan, `plot-plan-meta.sh` read that value as no branch and reported it in `unread_waits`. PR #3589 removes Bitbucket from `HOST_ISSUE_LISTERS` and the craftamap issue code, and names the `--json` probe as the follow-up that slice 3 does.
- Pre-flight, 2026-11-20: no plan file and no `idea/` branch named `bitbucket-shares-one-budget-with-bb`; no Draft, Design or Approved plan shares three significant title words. `plot-deliverable-search.sh` found `DEFAULT_PREDICTED_HOST_LIMIT` at `declared-host-limit.ts:5` and `bitbucket-api.ts:8,84,177`, which slice 1 changes on purpose. It found nothing named `BB_STATE_DIR`, `bbLedger`, `bb_rate_limit` or `rate-limit --json`. `XDG_STATE_HOME` appears only in `budget-file.ts:13`, which explains why Plot's own ledger does not use it; slice 2 reads it only to find `bb`'s directory, as `bb` does.
