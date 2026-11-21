## Implementation brief — bitbucket-shares-one-budget-with-bb (wave 1: Listing and prediction)

- **Plan (canonical):** `docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md` on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3592 merged
- **Branch:** `bug/bitbucket-predicts-800-an-hour` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

This slice waits on nothing. `bug/bitbucket-lists-all-states-in-one-request` runs beside it and changes different lines. `bug/fleetd-counts-in-the-bb-ledger` waits on this slice for the 800 default.

### What to build

Plot predicts 10000 Bitbucket requests an hour where no `Host rate limit` is declared. A user API token has 1,000 an hour, shared with the bitbucket.org website, so the prediction is 12.5 times too high and tells every pacing reader that 9,000 more requests are free when none are. `bb` 1.15.0 refuses above 800 in the last 3,600 s (`BB_BUDGET_DEFAULT=800`). Operator decision, 2026-11-20: the default prediction is 800.

The change is one number in two implementations, plus every comment, doc and test that names 10000 as the default:

- **Domain:** `DEFAULT_PREDICTED_HOST_LIMIT` becomes 800 (`packages/domain/src/rules/declared-host-limit.ts:5`).
- **Shell:** `budget_reading`'s Bitbucket arm prints 800 where the key is unset or does not read as a limit (`skills/plot/scripts/plot-host.sh:3572`, the `|| echo 10000`).
- **Corpus:** `packages/domain/corpus/declared-host-limit.corpus.test.ts` keeps holding `declaredHostLimit` and the shell to one answer. Its "not vacuous" check (`:63-66`) gains `expect(shellValues).toContain('800')`, so the empty case is proved too. Its `CASES` list holds `'10000'` as a declared value, which stays: a declared 10000 is still a legal value.
- **Comments and docs that name 10000 as the default:** `packages/domain/src/adapters/host/bitbucket-api.ts:165`, `plot-host.sh:3557` and `:5718-5719`, and `skills/plot/scripts/plot-config.sh:233-238`. The last one also states that neither client sends an access token today, so a value above 800 has no effect yet. Check `bitbucket-api.ts:84` and `:177` by reading them: they name the constant and need no number.
- **Tests that pin 10000 as the default and change to 800:** `packages/domain/test/declared-host-limit.test.ts:10-16` (the name and both values), `packages/domain/test/host-reads.test.ts:161` and `:179`, `packages/domain/test/bitbucket-api.test.ts:272` (the name), `:286` and `:350` (the values), and `test/reconcile/host.test.mjs:7120` (the assertion and its message).

The plan is canonical; this is orientation. Read the plan's *Slice design › Slice 2* and *Notes › Why 10000 is wrong for a user token* before you start.

### Settled decisions — do not re-derive

- **The 10_000 values that stay.** `packages/domain/test/bitbucket-api.test.ts:320`, `:328`, `:336` and `:341` send `X-RateLimit-Limit: 10000` as a stated header and expect basis `actual`. The 10_000 values in `budget.test.ts` and `concurrency.test.ts` are stated headers too. A stated limit outranks the key and the default, so none of these changes. A global replace of `10000` fails these.
- **`Host rate limit` keeps its precedence:** `X-RateLimit-Limit` on a reply, then the key, then 800. This slice changes the last step only.
- **800 and not 1,000.** The website in the user's browser spends from the same 1,000, and parallel callers with no lock pass a ceiling by a few requests. `bb` keeps 200 below the host's limit for both reasons, and one number for both clients keeps one ledger meaningful.
- **A declared value above 800 stays legal and has no effect on `bb`.** The ceiling that `bb` applies is `BB_HOURLY_LIMIT`, else 800. Slice 3 (`bug/fleetd-counts-in-the-bb-ledger`) makes `Host rate limit` lower the ceiling and never raise it. This slice adds no ceiling and touches no ledger. Do not add either.
- **The shell and the domain stay one answer.** The corpus pair holds `declaredHostLimit` and `budget_reading` to one answer, and on a disagreement the branch stops. Do not adjust either side to make the comparison pass.
- **Carried-over invariants:** an absent or unreadable key is the default and never an error. A function you write is an arrow function. The shell calls no new host command.

### Done when

The plan's `## Done when` list is the specification. The plan's slice line names these assertions; each exists because a naive change passes without it:

- **The corpus proves the empty case.** `expect(shellValues).toContain('800')`. Without it the shell can keep printing 10000 for an unset key while the TypeScript side says 800, and the pair still passes on the cases where a key is declared.
- **The renamed tests assert 800 and carry the name 800.** A test named "answers 10000" that asserts 800 reads as a defect to the next person.
- **The stated-header tests keep 10_000 and basis `actual`.** They prove the stated limit outranks the default.
- **No default-naming 10000 survives.** `grep -rnE '10000|10_000'` over `packages/domain/src`, `skills/plot/scripts/plot-host.sh` and `plot-config.sh` returns no line that calls 10000 the default, the fallback or Atlassian's cap for this key.

Plus: this slice touches `plot-host.sh` and `plot-config.sh`, so `scripts/check-shell-lines.sh pr` must not read higher than at the merge base. A number change and comment rewrites add no command. Add a changeset (description first, `bumps:` block last, package `plot`; the plan's changelog bullet 2 is the description). Commit no board bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Tests that touch a temp path use a private directory and remove it by the exact name `mkdtempSync` returned.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it is open, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/declared-host-limit.ts`, the comment at `packages/domain/src/adapters/host/bitbucket-api.ts:165`, the `budget_reading` Bitbucket arm and the two comments at `skills/plot/scripts/plot-host.sh:3557` and `:5718`, the comment at `skills/plot/scripts/plot-config.sh:233-238`, `packages/domain/corpus/declared-host-limit.corpus.test.ts`, and the five test files named above.

Not this branch's: the Bitbucket listing requests, `scanListingCost` and `PR_REQUESTS_PER_REFRESH` (`bug/bitbucket-lists-all-states-in-one-request`), `rules/bb-ledger.ts`, `bb-ledger-file.ts` and any ledger or pause code in `bitbucket-api.ts` (`bug/fleetd-counts-in-the-bb-ledger`), and the `limit` op, the exit-75 mapping, the `bb()` wrapper and the craftamap probe (`bug/plot-host-reads-bb-rate-limit`). Verified at dispatch: of those three branches only the first has a brief on `origin/main`, and `bug/bitbucket-lists-all-states-in-one-request` edits the listing, window and sweep paths of `plot-host.sh`, not `budget_reading`. Edit only the one line at `:3572` and the two comments there, so the merge stays clean.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
