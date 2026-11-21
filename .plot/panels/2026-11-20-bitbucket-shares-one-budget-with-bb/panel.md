# Panel — bitbucket-shares-one-budget-with-bb

Round 1, 2026-11-20. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects.

## What all three found

1. **Two ceilings over one ledger lock `bb` out.** The plan's recommended rule lets fleetd use the declared `Host rate limit` (e.g. 10000) when `BB_HOURLY_LIMIT` is unset, while `bb` refuses at 800 (`cli/bb:355`, `:607-652`). Once fleetd writes 800 lines into the shared files, every `bb` call — including every Bitbucket op in `plot-host.sh` — exits 75 while fleetd keeps sending. Slice 3's shell would report min(ceiling, declared) = 800 while fleetd records 10000. Amend: one ceiling for both clients, read with `bb`'s rule (`BB_HOURLY_LIMIT`, default 800); `Host rate limit` stays the prediction only and may lower but never raise the ceiling; one rule in `rules/bb-ledger.ts` decides it for the client and the shell.
2. **The limit reading's arithmetic is duplicated and can stick at `exhausted`.** The shell computes `remaining`/`reset` itself, sets no reset while `wait_seconds` is 0, and `rateLimitOf` reads `remaining 0, reset null` as exhausted (`delivery-readings.ts:97-99`), which stops loop agents. Amend: the reading comes from the domain rule; `remaining 0` always carries a reset; unit cases for null, ceiling off and declared versus ceiling.
3. **`command bb`** for the new `bb --version` and `bb rate-limit --json` calls; the `bb()` wrapper (`plot-host.sh:3846` on main) takes a host slot and writes a `budget.tsv` row for a call that sends nothing.

## Where the lenses add their own weight

- **Corpus coverage** (estate 2, testability 2): the recorder needs `bb_now`, `bb_date_utc`, `BB_BUDGET_WINDOW`, `BB_PAUSE_SKEW`, `bb_state_path`, `bb_pause_write`; the corpus must also hold `bb_account_key` (with mixed-case and non-ASCII emails: `tr` leaves non-ASCII alone, JS `toLowerCase` folds it, so the two ledgers would silently miss each other), `bb_hourly_limit` (including an invalid value, where `bb` exits 1) and the merge-before-rename in `bb_pause_write`. The recorder needs `bb` 1.15.0 and a loopback `BB_API_URL`; this machine has 1.13.0.
- **Board wording** (user 2): ceiling, pause and host 429 all read "the host's rate limit is spent" (`host-notes.ts:355-361,497-503`). Amend: a domain property that tells the three apart, with `bb`'s words and the next free time, unit-tested per board sentence.
- **Keep an identity check** (user 3): the craftamap probe prevents silently empty PR lists (`plot-host.sh:2772-2779` comment) and sends no Bitbucket request, so removing it saves no budget. Amend: keep one check on the cached `bb --version` that exits 3 and names the install command.
- **Tests and line references** (estate 3, testability 3): #3589 merged, so the Note is stale and slice 3's references move to `origin/main` (`die3` `:685`, `budget_reading` `:3566`, `bb()` `:3846`, probe `:2656`); list per slice the tests that break or go (`declared-host-limit.test.ts:10-16`, `host-reads.test.ts:161,179`, `bitbucket-api.test.ts:350`, `host.test.mjs:7389-7391,6169,6183,6229,6257,8034-8058`, `bb-capability-probe.test.mjs`).
- **Test isolation** (testability): the census sandbox and existing `bitbucketApi(...)` tests must strip `BB_STATE_DIR`, `XDG_STATE_HOME`, `BB_HOURLY_LIMIT` and use a temp ledger, or a test can pause a person's real `bb`.
- **Exit 75** (testability): name the mechanism; `die3` sees words and serves every backend; stub output from recorded `bb` stderr.

## A fact the plan states wrongly

Neither client can send a workspace or repository access token: both send email + token as Basic (`bitbucket-api.ts:224`, `cli/bb:664`). The Changelog's access-token example has no working path today; the plan should say the override can only lower the limit until a token path exists.

## What the jurors looked at

All three opened the cited code and `cli/bb` at agent-skills `2c904ab17`; none ran `bb` 1.15.0 or the tests.
