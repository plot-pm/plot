## Implementation brief — empty-jira-inbox-read-as-a (wave 2: Duplicates)

- **Plan (canonical):** docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2809 merged
- **Branch:** `bug/ticket-rows-appear-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This is wave 2 of 3. Wave 1 (`bug/an-absent-inbox-guesses-no-spelling`, → #2814) and wave 3
(`bug/draft-rows-obey-mine`) both wait on this one merging first — `sliceVerdicts`
(`packages/domain/src/rules/eligible.ts:157`) reads the three slices as eligible, blocked,
blocked, and wave 1 already touches `waiting-tickets.ts` and its test file, so do not run
both at once.

### What to build

About twelve ticket rows (EWZKUS-3897 … 3849) appeared twice in sequence on the live board.
Two independent gaps produce this, and both are still present on `main` as of this brief:

1. **`foldIssueRows`** (`packages/domain/src/rules/fold-issue-rows.ts:32-46`) pushes every
   `held` row's key into `order` with no duplicate check (`:36-38`): `foldIssueRows([A, A],
   [])` returns two rows today. The `incoming` loop already guards with
   `!order.includes(row.number)` (`:43`) — only the `held` side is unguarded.
2. **`waitingTickets`**'s two fallback arms (`packages/domain/src/rules/waiting-tickets.ts:223`
   and `:237`) render `[...candidates].sort(byNewestFirst)` with no dedup, where `candidates`
   is `inbox ?? rows`. Only the matched arms (`:207`, `:252`) call `unionDedup` (`:103-111`).
   If `candidates` itself carries a repeated key — e.g. from an upstream paged read that
   dropped a repeated page token but not a repeated issue key
   (`packages/domain/src/adapters/tracker/tracker-shell.ts:277-299`) — the fallback arms show
   it twice.

### The decisions the plan settles — do not re-derive them

**Fix at both funnels, not just one.** The plan's panel round 1 decided this explicitly: fix
the index write (`foldIssueRows`, reached by `foldChangedIssueRows` and `issueWriteThrough`)
*and* the `waitingTickets` read, without waiting for a measurement of the live ewz
`issues.json`. Fixing only `foldIssueRows` would still let a duplicate already sitting in
`rows` or `inbox` (e.g. from a store written before this fix, or an upstream read this plan
doesn't otherwise touch) render twice through the fallback arms.

**The existing `replaces` rule decides ties — do not add a second one.** Between two rows for
one key, `replaces` (`fold-issue-rows.ts:14-18`) already says: a row with `updatedAt` beats one
with none, the newer `updatedAt` wins, and on a tie or where neither has one the incoming row
wins. The fix for the `held`-duplicate case must go through this same function rather than a
bespoke comparison, so `held` `[A@1, A@2]` resolves exactly as `foldIssueRows` would resolve
`[A@1]` against incoming `[A@2]`. `packages/domain/test/fold-issue-rows.test.ts:23` and `:41`
already pin "a newer held row stays" and "an older held row loses" — those must keep passing
unchanged; the new within-`held` case is additive.

**`issueWriteThrough` and `foldChangedIssueRows` need no separate fix.** Both already funnel
through `foldIssueRows` (`issue-write-through.ts:3,80,82`; `fold-issue-rows.ts:87-88`), so
fixing `foldIssueRows` itself closes both callers. Confirm this with the regression tests
below rather than touching either file's logic.

**`unionDedup` is already correct and out of scope.** It is a template, not a bug: both
`waitingTickets` matched arms already call it (`:207`, `:252`), and
`waiting-tickets.test.ts:69` already pins "a matched Jira reader whose own ticket is in both
inbox and rows counts it once". The two *unmatched* fallback arms (`:223`, `:237`) are what's
missing the same treatment — reuse `unionDedup` there too, or an equivalent single-input dedup,
rather than inventing a second mechanism.

### Done when

The plan's `## Done when` is implicit in its Design section for this slice: one row per
ticket key, enforced at `foldIssueRows` (including a duplicate already inside `held`), through
`foldChangedIssueRows` and `issueWriteThrough`, and at every `waitingTickets` arm — under the
existing `replaces` rule, with regression tests.

Concretely, add tests that would fail on `main` today:
- `foldIssueRows([A@t1, A@t2], [])` returns one row, resolved by `replaces` the same way
  `foldIssueRows([A@t1], [A@t2])` would resolve — this is the gap `fold-issue-rows.test.ts`
  does not yet cover (checked at skim time: no existing test calls `foldIssueRows` with a
  duplicate key inside the same `held` array).
- An overlapping `foldChangedIssueRows` read (the same key present in both `open`/`closed` and
  `changed`) still yields one row.
- An overlapping `issueWriteThrough` write (a write for a key already held) still yields one
  row — exercise this through `issueWriteThrough`'s own fold, not by re-deriving the assertion
  against `foldIssueRows` directly.
- Each `waitingTickets` fallback arm (`:223`, `:237`) fed `candidates` containing a repeated
  key shows it once. Add this alongside the existing unmatched-reader tests in
  `packages/domain/test/waiting-tickets.test.ts` (`describe('waitingTickets, the unmatched
  reader', ...)`, around line 137).
- Assert, across the fixtures above, that no key appears twice on any arm and that `hidden`
  never exceeds the number of distinct keys — the plan's own phrasing for the regression
  tests' intent.

Plus: the repo's gates — build artifacts, changeset, platform constraints. For tests, run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it
prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as
a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer
than at its merge base — not expected to matter here since this slice is TypeScript-only
(`packages/domain/src/rules/fold-issue-rows.ts`, `issue-write-through.ts` if touched,
`waiting-tickets.ts`), but if a `.sh` file ends up touched, growth must be paid for in the same
change.

### Bookkeeping

Open the PR through the controller once there's a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line
in the plan's `## Slices` section, under the `### Duplicates` heading:

```
- `bug/ticket-rows-appear-once` — one row per ticket key in `foldIssueRows` (including a
  duplicate in `held`), through `foldChangedIssueRows` and `issueWriteThrough`, and at every
  `waitingTickets` arm, under the existing `replaces` rule, with regression tests → #<number>
```

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:
- `packages/domain/src/rules/fold-issue-rows.ts`
- `packages/domain/src/rules/waiting-tickets.ts` (the two fallback arms only — wave 1 already
  owns the inbox-outcome logic in the same file; check `git log`/the open PR for wave 1 before
  editing to avoid colliding with its hunks)
- `packages/domain/test/fold-issue-rows.test.ts`
- `packages/domain/test/waiting-tickets.test.ts` (new cases only; do not touch wave 1's
  expectation changes at and around line 175)
- `packages/domain/src/rules/issue-write-through.ts` only if a regression test surfaces a real
  gap there beyond what `foldIssueRows` already closes — expected to need no logic change.

Other branches in flight on this plan, verified at dispatch:
- `bug/an-absent-inbox-guesses-no-spelling` (wave 1, Inbox) — touches `waiting-tickets.ts` and
  its test file for the inbox-outcome arms (`unaskable`/`failed`/`not-read`), and
  `packages/fleet/src/shared/issue-refresh.ts`, `packages/domain/src/entities/issue-index.ts`,
  `packages/board/src/server/fleet.ts`. Must merge before this branch's PR, per the wave order.
- `bug/draft-rows-obey-mine` (wave 3, Draft rows) — touches `packages/board/src/app/components/
  AgentList.tsx`, `packages/board/src/contract/schema.ts`, `packages/board/src/server/
  fleet.ts`, `packages/board/src/app/lib/agent-rows/working-agents.ts`. Blocked on this branch
  merging; no file overlap expected.

If you find something the plan did not anticipate, report it rather than improvising outside
scope — in particular, the plan notes the live ewz `issues.json` was never measured for this
defect, so do not add remediation for a measurement that hasn't been taken.
