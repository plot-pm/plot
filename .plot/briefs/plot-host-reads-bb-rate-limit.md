## Implementation brief — bitbucket-shares-one-budget-with-bb (wave 3: Shell reading)

- **Plan (canonical):** `docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3592 merged
- **Branch:** `bug/plot-host-reads-bb-rate-limit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 3 of 3, the last. Both predecessors have merged: slice 1 (#3601, one all-state listing request) and slice 3 (#3682, `rules/bb-ledger.ts` with `bbLimitReading` and `bbThrottleCause`). Nothing waits on this branch except delivery.

### What to build

Three changes to `skills/plot/scripts/plot-host.sh`, plus the one TypeScript call that feeds the rule. Line numbers are `origin/main` at `ce99c2beb`, and they move.

1. **Exit 75 is throttled, by its code.** `die3` (`:685`) exits 3. `bb` exits 75 for a ceiling refusal, a pause and a 429, and only `pr_list_failed` (`:845`) turns "rate limited" into exit 5. Every other Bitbucket op reaches `refusalKindOfExit` (`host-shell.ts:199`) as `failed`, and a caller counsels looking where it should wait. The `bb()` wrapper (`:3859`) runs inside command substitutions, so a variable it sets never reaches the parent. It writes each call's exit code to one per-run file, and `die3` exits 5 where that file reads 75.
2. **The `limit` op reads `bb`.** The Bitbucket arm of `limit` (`:5700-5712`) prints `limit` from `budget_reading` and `"remaining":null`. It runs `command bb rate-limit --json` instead. On exit 0 or 75 with valid JSON it prints `requests`, `ceiling`, `paused_until` and `wait_seconds` beside the declared limit. On any other answer it prints today's line. `limitOf` in `host-shell.ts` (`:163`, called at `:592`) passes those fields to `bbLimitReading(fields, declared, now, connector)`, which exists and is tested. The shell computes nothing.
3. **One identity check replaces the craftamap probe.** `bb_identify`, `bb_test_json_support`, `bb_require_json` and `BB_CAP_*` (`:2688-2820`, about 150 lines) go. One cached `command bb --version` per run must name `quatico-bb`, else the op exits 3 with `bb is not Quatico's bb (<version line>) — install it with brew install quatico-solutions/tap/quatico-bb`. The 12 `bb_require_json` call sites call the check. `bb_list_page_length` (`:3238`) reads the cached version and keeps `BB_LIST_PAGE_VERSIONS` (`:3233`, `1.9.0`) and its twin in `adapters/host/listing-paging.ts`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`budget_reading` stays a free prediction with no `bb` call.** `budget_record_call` calls it (`:3620`), and the `bb()` wrapper calls that after every request. A `bb rate-limit` there adds one process per request. The `limit` op is the only reader of `bb rate-limit`. `bb rate-limit --json` sends no request and takes no host slot, so the `limit` op and a `pr-list` add zero `budget.tsv` rows beyond their API calls. `command bb --version` and `command bb rate-limit --json` run as `command bb`, outside the `bb()` wrapper, so they record no row either.

**No shell duplicate of `bbLimitReading`.** The shell hands fields over and the domain decides, so the client and the shell share one rule and `bb-ledger.corpus.test.ts` already holds it. Writing the `remaining` arithmetic in bash is the move the plan refuses.

**The exit-code file can misattribute a later failure (panel round 2, testability 2).** A 75 from an earlier `bb` call must not turn a later unrelated failure into exit 5. Each `bb()` call overwrites the file, so the last call's code is the one read. Test a 75 followed by a successful `bb` call that still ends in exit 3. Use `plot_tmpfile` and `plot_on_exit`: `scripts/check-temp-paths.sh` refuses `mktemp` and a second `trap`. Only `bb()` writes the file, so a GitHub, Jira or Jenkins op keeps its exit whatever its stderr says, and one test proves a GitHub op whose stderr says "rate limit" keeps exit 3. `pr_list_failed`'s word match stays.

**The identity check refuses a craftamap-shaped banner, not every old Quatico `bb` (panel round 2, estate 1 and user 1).** `--version` prints only `bb X.Y.Z` up to 1.12.1, and the `quatico-bb` suffix ships in 1.13.0. A check that demands the word `quatico-bb` refuses a working 1.12.1. Refuse the craftamap shape (a git sha in parentheses), or name "older than 1.13.0" in the message. State what happens to the 1.9.0 row of `BB_LIST_PAGE_VERSIONS`, since `BB_CAP_IDENTITY` held that version. Test with a stub that prints `bb 1.12.1`.

**The shell route has no clock and a second reader (panel round 2, testability 3).** `limitOf` (`host-shell.ts:163`) has no `now` for `bbLimitReading`, so thread one in from the adapter's clock. `tracker-shell.ts:188` exports its own `limitOf` over the same `limit` lines, and the tracker connector reads the same shape. Do not widen the tracker's reading by accident. Check the recorded `rate-limit --json` outputs against the rule's count over the same ledger files.

**A `bb` older than 1.15.0 is the normal case on this machine.** Measured 2026-11-20: `/opt/homebrew/bin/bb` is 1.13.0 and answers `bb rate-limit --json` with `unknown command: rate-limit` and exit 1. The limit op must print today's line then, with no error. Recorded fixtures under `packages/domain/corpus/fixtures/bb-ledger/` (from slice 3) hold the 1.15.0 outputs, so the stub serves them and the tests need no `bb` 1.15.0.

**Rules carried over unchanged:** absent is not false — a `rate-limit` answer that cannot be read means "print today's line", never "no limit"; read the exit code, not the emptiness of stdout; the host answers *did this land*, never ancestry; `plot-host.sh` stays the one place that talks to the host CLI.

**Out of scope:** the access-token path and the `budget.tsv` over-count on a refused call (the plan's two Open Questions; file the issues, do not build them), webhooks, and any change to `bb`'s own formats.

### Done when

The plan has no `## Done when` section. The specification is the slice's line and Changelog lines 4 and 5: the Bitbucket limit reading names how many requests remain, and a `bb` exit 75 reaches Plot as throttled. Tests the plan names, each catching a naive pass:

- A stub `bb` that exits 75 and prints each recorded stderr line (ceiling, pause, 429, 429 on a later page) drives one op through each Bitbucket error path, and every op exits 5. A naive fix in `pr_list_failed` alone passes the `pr-list` case and fails the rest.
- A GitHub op whose stderr says "rate limit" keeps exit 3 (catches a stderr-word match widened to every backend).
- A 75 followed by a successful `bb` call that still ends in exit 3 (catches a stale exit-code file).
- The `limit` op with the recorded `rate-limit --json` fixtures (idle, at the ceiling, paused, count unknown, ceiling off) prints readings that equal `bbLimitReading` over the same fields. With the 1.13.0 answer (`unknown command`, exit 1) it prints today's line.
- `host.test.mjs:7120-7122` (*"remaining null"*, *"bb has nothing to answer — do not ask it"*) inverts. The `limit` op and a `pr-list` add zero `budget.tsv` rows beyond their API calls.
- The identity check with a stub craftamap `bb`, and with a stub printing `bb 1.12.1`.
- Tests that go or change: `test/reconcile/bb-capability-probe.test.mjs` (4 tests) goes. The probe tests in `host.test.mjs` (`:5900`, `:5914`, `:5960`, `:5988`) become identity-check tests. `PLOT_BB_SKIP_CAP_CHECK` goes from the 17 lines in 7 files under `test/` and `packages/` (`git grep -n PLOT_BB_SKIP_CAP_CHECK`). `CAPABILITY_CHECK_OVERHEAD` becomes 0 in `host.test.mjs` (`:7789-7790`), because `command bb --version` records no row.

Plus: add a changeset (description first, `bumps:` block last, package `plot`; name the plan on a `plan:` line). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh` and must read **lower**: the probe block is about 150 lines, and the identity check, the exit-code file and the `rate-limit` read add a few dozen. The gate counts commands, not lines, so joining statements with `;` or folding `fi` onto the line before pays nothing. Report before and after from `check-shell-lines.sh --per-file`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Shell reading` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-host.sh` (`die3`, the `bb()` wrapper, the `limit` op's Bitbucket arm, the probe block, the `bb_require_json` call sites), `packages/domain/src/adapters/host/host-shell.ts` (`limitOf` and its call), `packages/domain/src/adapters/host/listing-paging.ts` (only the `bb` version twin), the host, probe and corpus tests that name the probe, and one changeset.

**Collision, verified at dispatch: open PR #3639 (`experiment/bb-needs-no-json-probe`, not a draft) already removes the same probe.** It changes `plot-host.sh`, `listing-paging.ts`, `host.test.mjs`, `scan.test.mjs`, `cross-host-pr-reference.test.mjs`, `test/reconcile/bb-capability-probe.test.mjs` and four `packages/domain/corpus/` files, and carries no plan. Before you cut the identity check, read its diff. If it merged, the probe is gone and part 3 shrinks to the identity check on top of it. If it is still open, report which of the two lands first rather than writing a second removal that conflicts with it. Do not close or edit #3639. Its title reads *a Bitbucket command calls bb with no --json probe*, which is plan part 3's first half.

Slices 1 and 3 are merged and own nothing now. `rules/bb-ledger.ts` and `adapters/host/bb-ledger-file.ts` are read-only here: if `bbLimitReading` needs a change, report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
