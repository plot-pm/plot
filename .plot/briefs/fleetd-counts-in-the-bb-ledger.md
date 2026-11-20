## Implementation brief — bitbucket-shares-one-budget-with-bb (slice 3: Shared ledger)

- **Plan (canonical):** docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3592 merged
- **Branch:** `bug/fleetd-counts-in-the-bb-ledger` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review by the review app)

This slice waits on nothing now: `bug/bitbucket-predicts-800-an-hour` (#3599) and `bug/bitbucket-lists-all-states-in-one-request` (#3601) are both merged. `bug/plot-host-reads-bb-rate-limit` waits on this slice, because the shell's `limit` op hands `bb rate-limit --json` fields to the `bbLimitReading` rule that this slice creates. Name and shape that rule for a second caller.

### What to build

fleetd reads Bitbucket over Node HTTPS (`packages/domain/src/adapters/host/bitbucket-api.ts`), and its requests are invisible to `bb`'s per-account ledger. `bb` 1.15.0 admits 800 requests an hour while fleetd spends from the same 1,000 per-user Bitbucket limit, ignores `bb`'s pause file, and starts no pause after its own 429. On 2026-11-18/19 one tool made about 40,000 requests in 24 h on a Quatico account (about 22,000 answered 429) and locked its owner out of bitbucket.org (Atlassian ticket BBS-258355). The fix makes fleetd one more `bb` caller: it counts into the same request files, obeys the same pause and the same ceiling, and writes the pause after a 429.

Build two things and wire them into `bitbucketApi`:

- `packages/domain/src/rules/bb-ledger.ts` — pure functions over values: hour stamps of a second, the ASCII-only lowercase step of the account key, the state-path choice, `bbCeiling`, the count and next free second over the two hour files' text, the pause parsed from its text, the stale test, the pause after a 429 from the stored pause, the merge-before-rename, the guard verdict (`send`, `paused`, `ceiling`), `bbLimitReading`, and `bbThrottleCause`.
- `packages/domain/src/adapters/host/bb-ledger-file.ts` — the only file IO: resolve the state directory from the environment it is given, hash the key with `node:crypto`, read, append, prune, rename. `bitbucketApi` takes it as one more seam with a production default, the way it takes `budget` and `slots`. The precedent is `adapters/build/jenkins-api.ts` (token store under `JEN_CONFIG_DIR`, temp file plus rename).

The plan's *Slice design › Slice 3* section is the full specification of the guard order, the refusal words, the cause sentences and the test list. This brief does not repeat it. It records what must not be rebuilt differently.

### Decisions the plan settles — do not re-derive them

**The format is `bb`'s, and this slice changes none of it.** The plan's *Design › Approach › The `bb` formats* list (state directory, account key, request file `requests-<key>-<YYYYMMDDHH>.log`, count, prune, pause file, stale pause, pause after 429, pause write, ceiling, refusal words, fail open) is read from `cli/bb` at agent-skills `2c904ab17` (v3.22.0, `bb` 1.15.0). A request line is the epoch second in decimal digits and `\n`; a pause line is `<end> <len>\n`. Both are byte-exact.

**Domain rule plus adapter, not a new port.** The purity gate lets the domain import only `zod` outside `adapters/`, and *The Layering Rule* forbids domain behaviour outside the domain. A port would add a seam that nothing else needs. The shape is *readings as values*: the rule decides from the text it is given.

**`bbCeiling` takes `declaredLimit: number | null`, never the filled-in default.** `host-reads.ts` passes `declaredHostLimit(...)`, which fills in 800 where the key is unset, so `BB_HOURLY_LIMIT=2000` with no `Host rate limit` would give 800. Pass the declared value or null (panel round 2, estate 3). The ceiling is the smaller of `BB_HOURLY_LIMIT` and the declared limit where one is declared. `BB_HOURLY_LIMIT` unset or empty is 800, `0` is off, more than 9 digits is 999999999, anything else is invalid and refuses every request as `failed` in `bb`'s words. `Host rate limit` may lower the ceiling and never raise it, so an operator cannot lock `bb` out of the shared ledger.

**A `remaining` of 0 never carries a null `resetAt`.** `rateLimitOf` (`packages/board/src/app/lib/agent-rows/delivery-readings.ts`) sticks at `exhausted` on a null reset. Order for `resetAt`: the pause's end, else `now + waitSeconds` where above 0, else the next free second by this ceiling where the request lines are known (the client), else `now + 3600` s (the shell). Prefer parsing the `(in N s)` of `bb`'s refusal over a guessed `UNSTATED_RESET_MS` (round 2 note).

**The guard wraps each `transport.exchange`, not `request`.** The second exchange after a 401 must be guarded and counted too. The guard runs before `connectorHttps.exchange` takes a slot and records a `BudgetEntry`, so a refused request appends nothing to either ledger. Order inside the guard: pause first, then the count at the ceiling, then append, prune, send. `bb` appends before it sends, so a request that Bitbucket answers with 429 counts.

**Fail open, as `bb` does.** An unusable state directory, an unreadable request file, a failed append, a failed pause write, a garbage line, a line from the future and a stale pause never block a request. Log one warning per process. Each fail-open path has a test that sends exactly one request and logs one warning.

**No lock, as in `bb`.** A request line is at most 13 bytes, below `PIPE_BUF`, and goes out as one `O_APPEND` write, so parallel writers do not tear a line. The pause file changes by rename only, with the merge-before-rename so parallel 429s cannot shorten a pause. Parallel callers can pass the ceiling by a few requests; the 200 requests between 800 and 1,000 absorb that. Do not add a lock.

**The account key is the user's, not the workspace's.** Compute it from the email the client already resolved (`BB_EMAIL`), lowercasing ASCII `A`–`Z` only, to match `bb`'s `tr` under the C locale. Plot's own `budget_account` for Bitbucket stays the workspace; it keys `budget.tsv`, a different ledger, and this slice changes neither key. Log once per process the key, the request file path and the client's own count, so a person can compare them with `ls` and `bb rate-limit`.

**fleetd under launchd sees none of the operator's shell variables** (round 2, user 2). The unit sets only `PLOT_REPO_ROOT` and `PATH`. Read `BB_HOURLY_LIMIT`, `BB_STATE_DIR` and `XDG_STATE_HOME` from the `.env` files fleetd already reads, or bake them into the unit, and log the resolved ceiling and state directory. The adapter reads them from `options.env`, never from `process.env`.

**The throttle cause must reach the fleet-scan sentence** (round 2, all three jurors). `scanHostNote` reads only `summary.host`, an enum, so a cause computed in the client never arrives. Add a carried field (for example `summary.hostCause`) with its writer, its `plot-state:` declaration and a test that reads an older pulse without it. Put the quota sentence's cause on `prStatus`'s result. `bbThrottleCause(said)` answers `ceiling`, `paused` or `host` from `bb`'s fixed phrases, for the client's words and `bb`'s stderr alike. A 429 keeps `throttledOf`'s kind and words.

**Rules carried over unchanged.** Absent is not false: an unreadable ledger is "unknown", never zero requests. Read the exit code, not the emptiness. A reply with a numeric `X-RateLimit-Limit` keeps basis `actual` (PR #3579).

### The corpus, and a precondition on this machine

The rule is a declared duplicate of `bb`'s own, so it joins the corpus tier (*A Shell Script Asks The Domain*). Add `packages/domain/corpus/record-bb-ledger.mjs`, `fixtures/bb-ledger/` and `bb-ledger.corpus.test.ts`, shaped like `record-jenkins-reads.mjs` and `jen-url.corpus.test.ts`. The plan lists the lifted `bb` functions, the fixed inputs and the cases (mixed-case and non-ASCII emails under `LC_ALL=C` and under a UTF-8 locale, empty `BB_STATE_DIR` and `XDG_STATE_HOME`, `BB_HOURLY_LIMIT` of `0`, `010`, ten digits and `abc`, a merge against a longer stored pause, the `bb rate-limit --json` outputs, the exit-75 stderr lines, and one interop read of a TS-written file by the lifted `bb_budget_count` and `bb_pause_read`). Set `BB_API_URL` to a loopback value, because `bb_now` honours `BB_NOW` only then.

**Precondition: the recorder refuses any `bb` that does not report 1.15.0, and this machine has 1.13.0** (`brew upgrade quatico-bb`). Upgrade first, or record on a machine that has 1.15.0. The corpus test itself reads the committed fixtures and needs no `bb`, so CI needs none. If the recorded answers and the rule disagree, the branch stops: name both answers and the subject, and change neither side to make the comparison pass. A key that differs between the two locales is such a disagreement.

### Done when

The plan has no `## Done when` list; the slice line and *Slice design › Slice 3* are the specification. Lift these assertions, which a naive implementation passes without:

- Six parallel writers append and no line tears (after `test/reconcile/budget.test.mjs:337`). Catches a read-modify-write append.
- Request and pause lines are byte-exact (`<epoch>\n`, `<end> <len>\n`). Catches a trailing-space or CRLF line that `bb` reads as garbage and ignores.
- A refused request appends no line to the `bb` ledger and records no `BudgetEntry` in Plot's. Catches a guard placed after the slot.
- The second exchange after a 401 is guarded and counted. Catches a guard around `request` only.
- `BB_HOURLY_LIMIT=2000` with no declared key gives ceiling 2000, not 800; a declared 500 gives 500; a declared 5000 gives 2000. Catches the filled-in default in `bbCeiling`.
- `remaining` 0 with `waitSeconds` 0 carries a non-null `resetAt`. Catches `exhausted` sticking on the board.
- `delivery-readings.test.ts` and the `machine-health` tests gain a predicted Bitbucket bucket that is free, one at 0 with a reset, and a GitHub bucket whose Delivery-tab reading does not change.
- A unit test for each quota and fleet-scan sentence (`ceiling`, `paused`, `host`), and a pulse written before `summary.hostCause` existed still reads.
- **Test isolation:** every existing `bitbucketApi(...)` construction in a test (`packages/domain/test/fixtures/bitbucket-replay.ts`, `census/sandbox.unit.test.ts`, the domain tests) passes a temp ledger, and the census sandbox adds `BB_STATE_DIR`, `XDG_STATE_HOME` and `BB_HOURLY_LIMIT` to the variables it deletes (`packages/fleet/test/census/sandbox.ts`). A test that answers 429 must never write a pause file into a person's real `bb` state. Remove each temp directory by the exact name `mkdtempSync` returned.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Add a changeset for `plot` with the description first and the `bumps:` block last, naming the plan on a `plan:` line. Commit no board bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, pay for the growth in the same change by removing shell elsewhere or writing the rule in the domain; the gate counts commands, not lines, and has no override. New domain functions are arrows (`export const f = (…) => …`), and TSDoc states what an export does, not the history of the decision.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/bb-ledger.ts`, `packages/domain/src/adapters/host/bb-ledger-file.ts`, the `bitbucket-api.ts` wiring and its `spend`, `host-reads.ts`'s `bbCeiling` call, the quota and fleet-scan sentences in `host-notes.ts`, the `summary.hostCause` carry, `packages/domain/corpus/record-bb-ledger.mjs` with its fixtures and test, `packages/fleet/test/census/sandbox.ts`, and the tests named above.

Other branches of this plan: `bug/plot-host-reads-bb-rate-limit` (slice 4) is blocked on this one and owns `plot-host.sh`'s `limit` op, exit-75 mapping and identity check, plus `limitOf` in `host-shell.ts` and `tracker-shell.ts`. Do not touch those. Slices 1 and 2 are merged, so line numbers in the plan (written at `21ae2c638`) have moved: re-locate every reference by name, not by number.

Out of scope, both recorded as Open Questions in the plan: the Bearer access-token path, and the `budget.tsv` over-count of calls `bb` refused. File them as issues if you find them blocking; do not build them here. If you find something the plan did not anticipate, report it rather than improvising outside scope.
