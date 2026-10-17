## Implementation brief — jira-inbox-and-issue-index (wave 4: Coverage)

- **Plan (canonical):** docs/plans/2026-10-16-jira-inbox-and-issue-index.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1860 merged
- **Branch:** `feature/the-tracker-connector-paths-are-tested` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on `main`)

This is the last of four waves and the only one with no sibling branch left in
flight — `feature/the-jira-inbox-read-reports-truncation` (PR #1893),
`feature/the-ticket-prefix-scope-has-one-source` (PR #1926) and
`feature/the-closed-set-answers-for-itself` (PR #1935) are all merged to
`main`. This slice adds tests only; it does not touch the three fixes those
waves shipped, and nothing after it waits on it.

### What to build

Three gaps, each independently verified against `main` at this writing (so
treat these as current facts, not the plan's restated claim):

1. **`tracker-fixture.ts` sits at 47% function coverage, confirmed.** Running
   `vitest run --coverage --coverage.include='src/adapters/tracker/tracker-fixture.ts'`
   scoped to its four consuming test files
   (`tracker-closed.test.ts`, `tracker-issue-url.test.ts`,
   `tracker-issues.test.ts`, `tracker-shell.test.ts`) reports 47.05% functions,
   58.82% statements, with uncovered lines 83, 93–108, 140 — the
   `statusWrite` outcome/fail branches, the `issueOpen` record/fail/success
   path, and `spender`. Add tests that exercise `trackerFixture()` directly:
   `statusWriteFails: true` → `failed()`; a custom `outcome` (e.g.
   `'no-target'`) is returned verbatim; `written` records the attempt even
   when it fails; `issueOpenFails: true` → `failed()` while `opened` still
   records the attempt; a successful `issueOpen` returns `{outcome: 'opened',
   id: String(opened.length)}` (confirm the id increments across calls); and
   `spender()` answers the fixture's `spender` or the `{connector: 'fixture',
   account: null}` default.
2. **The issue-open budget record is unpinned.** `jira_curl` (plot-host.sh:2617)
   calls `budget_record_jira` unconditionally, before `jira_check` evaluates
   the HTTP status — so a 4xx-rejected `issue-open` still spends budget. No
   test asserts this. The nearest precedent is
   `test/reconcile/host.test.mjs:7574` ("issue-open github closed records one
   extra call per 100 rows"), which reads `budget.tsv` row count after a run
   via `PLOT_BUDGET_HOME`. Write a Jira-side sibling: run `issue-open` against
   `makeJiraSequenceStub` with a 400 response, point `PLOT_BUDGET_HOME` at a
   temp dir, and assert `budget.tsv` gained exactly one line keyed `jira`
   despite the exit-3 failure.
3. **The Jira 4xx-on-create test exists but checks only the message.**
   `test/reconcile/host.test.mjs:7647` ("issue-open reports a Jira refusal as
   exit 3 with nothing on stdout") already pins exit code, empty stdout, and
   the `jira HTTP 400 — issuetype is invalid` stderr line via
   `makeJiraSequenceStub`. What it does not pin is the domain-side mapping:
   `trackerJira.issueOpen` (tracker-jira.ts:189) hands the finished run to
   `issueOpenOf` (tracker-shell.ts:109), which must turn that same exit-3 run
   into `failed()` with `lastRefusal()` carrying the stderr text. Add a
   `tracker-jira`-level (or `issueOpenOf`-level, per `tracker-shell.test.ts`'s
   existing pattern) test that stubs `plot-host.sh issue-open` to exit 3 with
   a Jira-style error body and asserts the port result is `{ok: false}` and
   `lastRefusal()` reports the stated reason — the layer #1659 L6 actually
   named and the shell test alone does not reach.

### Decisions already settled — do not re-derive them

- **This is a test-only slice.** The three production fixes it is meant to
  cover are already merged (PR #1893, #1926, #1935). Do not re-open or
  re-verify their logic; if a test here reveals a real behavioral gap in one
  of them, report it rather than fixing it inline — that is new scope outside
  this slice's named findings (#1688 L3, #1659 L6).
- **`trackerFixture` is not `trackerNone`.** It's the "a tracker is there and
  answers" double; tests belong on its own shape (`TrackerFixture` options),
  not on a connector's wire format.
- **Exit 4 is a standing fact, not a refusal** — `jira_check`/`issueOpenOf`
  only ever map it to `unaskable`. The 4xx-on-create path this slice covers is
  exit 3 (`failed`), a different branch; don't conflate the two when writing
  the domain-side test.
- **The budget record is written before the status check, deliberately**
  (`plot-host.sh:2630`, "JIRA IS COUNTED HERE ... the account is the Jira
  user"). A test asserting budget-on-failure is pinning existing behavior, not
  changing it.

### Done when

The plan's `## Done when` list doesn't exist as a separate section here — the
Design section's four grouped items are the spec, and this slice is item 4:
"Tests: `tracker-fixture.ts` coverage, the issue-open budget record, a Jira
4xx on create (#1688 L3, #1659 L6)." Treat it as done when:

- `tracker-fixture.ts` function coverage clears the domain package's global
  threshold (84% functions per the vitest config) when run as part of the full
  domain suite — not just the four files scoped above.
- A test fails if `budget_record_jira` stops being called on a failed
  `issue-open` (i.e. it actually exercises the code path, not just the
  stub's shape).
- A test fails if `issueOpenOf`/`trackerJira.issueOpen` ever read a 4xx run as
  `answered` instead of `failed`.

Plus: this touches no `.sh` file's line count in a way that matters (test
additions to `host.test.mjs` are JS, not shell under `skills/`), so
`scripts/check-shell-lines.sh` is not a concern here. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it resolves the related tests and typecheck for
`packages/domain/**`, which is what this slice touches. The `CI suites`
config key's suites (`test:e2e`, `test:contracts`, `test:board`,
`vitest run --coverage`, the reconcile `node --test` glob) run in CI on the
PR; don't run them locally as a matter of course.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

When it's created, append `→ #<number>` to this branch's line under
`## Slices` → `### Coverage` in the plan file, and set it to "Ready" on the
project board if one is configured (none is named in this repo's `## Plot
Config`, so skip that step).

### Scope guard

This branch owns test files only:

- `packages/domain/test/tracker-closed.test.ts`,
  `tracker-issue-url.test.ts`, `tracker-issues.test.ts`,
  `tracker-shell.test.ts` (or a new sibling file for the fixture-coverage
  tests, if that reads cleaner)
- `test/reconcile/host.test.mjs` (the budget-record and 4xx-mapping tests)

It does not own `packages/domain/src/adapters/tracker/*.ts` or
`skills/plot/scripts/plot-host.sh` — those are the three merged slices' code,
now frozen for this branch. All three sibling branches are gone (merged,
remote refs deleted); there is no other branch in flight on this plan to
collide with.

If you find a real bug while writing these tests — rather than a coverage gap
— report it; fixing it is outside this slice's scope.
