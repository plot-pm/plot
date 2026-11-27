## Implementation brief — a-stale-pending-review-is-asked-again (wave 2: Held Reason)

- **Plan (canonical):** [docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md](../../docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md) on `main`
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-held-stale-review-names-its-reason` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the head (the ruleset requires it since 2026-10-15)

This is wave 2. It waited on `bug/a-review-run-past-its-bound-is-dead`, which merged as #3748: `reviewRunLive` now takes the bound, the lock-holder path carries the lock's start, and `reviewTick` ends a run past the bound. The reason set this branch logs is complete only because that slice removed the unbounded `review-in-flight` hold. Rebase on `origin/main` and build on that code; do not redo it.

### What to build

On #3658 `plot/review` read `pending` for 9 h 11 min and nothing on the machine said why the fleet did not ask again. The records of 2026-11-22 do not survive (`.plot/state/review-starts.json` holds no row for #3658), so the cause was read from code, not from a log. Wave 1 closed the cause. This branch makes the next occurrence readable: where a trusted `pending` `plot/review` on the head is older than `REVIEW_BOUND_MS` and the review pass still starts no review, the pass writes one line to `.plot/state/slice-review.log`:

`plot-review: PR #<n> pending since <time>; held: <reason>`

`<reason>` is what the arm answered: `step.why` of a `none` (`out-of-scope`, `budget-spent`, `backoff`, plus the scope's own reasons) or `step.reason` of a `hold` (`review-in-flight`). One line per PR per head, not one per pass.

Where the code lives today:

- `runAutoReviewPass` (`packages/fleet/src/shared/auto-review.ts`) already appends one `reviewEndedLine` per ended run to `logFile` after `reviewTick`, and `logReviewStart` dedupes a refusal with the `logged` set (key `<pr>:<head>:<reason>`, kept by the caller for the daemon's life). The new line goes in the same place and dedupes the same way. Add a pure line builder beside `reviewEndedLine` and test it as a value.
- `reviewTick` returns `{ pr, step }` for every row, and the `step` of a non-`review` row is the arm's answer from `reviewPrNext` (`rules/slice-pr-next.ts`). The reason is therefore already in the result; the branch needs no new arm and no new read of the host.
- "Stale pending" is the arm's own test: `trustedReview(row) === 'pending'`, `row.plotReviewSha === row.headSha`, and `now - Date.parse(row.plotReviewAt) > reviewBoundMs` (`reviewArm`, `slice-pr-next.ts`, the `pendingStale` term). Do not copy that test into the fleet file. Extract it as an exported rule next to `reviewArm` (an arrow, domain style) that `reviewArm` and the pass both call, so the log line and the arm cannot disagree about what stale means. `<time>` is `row.plotReviewAt`.

### The decisions the plan settles — do not re-derive them

**The line is logged where the pass does not start a review, not where it does.** A stale pending that starts a review needs no explanation: the start is already logged by `logReviewStart` as `moved`. The reason line exists for the silent case, which is the case #3658 was.

**One line per PR per head.** A pass runs every few seconds; a line per pass would write thousands of lines for one stuck PR and bury the one that matters. Dedupe by `<pr>:<head>`, not by reason: the plan's test is "a second pass on the same head writes no second line", and a reason that changes between passes (`backoff` then `budget-spent`) still names the same stuck head. If you key by reason too, say why in the PR; the plan's test line is the specification and keying by head alone satisfies it.

**Do not rebuild `reviewArm`, and do not change its answers.** The arm already asks a new review for a stale pending. This branch reads the arm's answer and logs it. A change to which step an arm returns is outside this slice.

**The log is not the run log.** `slice-review.log` is a plain text file the pass appends to (see `reviewEndedLine`); `logReviewStart` writes `RunLogLine` records to the run log through `runLogOf(opts)`. The plan names `slice-review.log`. Do not write the new line to the run log.

**Carried over unchanged:** absent is not false. A row with no `plotReviewAt`, or one that does not parse, is not a stale pending, and writes nothing. The index never says "no review": the line is written only from a `pending` the row carries.

### Done when

The plan's slice `tests:` line is the specification:

- A stale pending out of scope writes one line naming `out-of-scope`. Assert the exact text, including the time.
- A second pass on the same head writes no second line. A single-pass assertion cannot catch a line per tick; the test must run two passes over one `logged` set.
- A pending under the bound writes nothing. Assert at the edge: exactly `REVIEW_BOUND_MS` old is not stale (the arm tests `>`), one millisecond past is.

Add one assertion beyond the plan's: a new head on the same PR writes a new line, because dedupe by PR alone would silence it. And one for a stale pending held by `review-in-flight` or `budget-spent`, so the reason is read from both `none.why` and `hold.reason`; a test over `out-of-scope` alone passes with the `hold` case unhandled.

Plus the repo's gates: no committed bundle diff (`scripts/check-no-bundle-diff.sh`), and a changeset in `.changeset/` for `plot` with the description first and the `bumps:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. This change is TypeScript only: no `.sh` file should change, so `scripts/check-shell-lines.sh` has nothing to count. If one does change, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

When the PR exists, append `→ #<number>` to this branch's line under `### Held Reason` in the plan's `## Slices` section.

### Scope guard

This branch owns the new stale-pending rule in `packages/domain/src/rules/slice-pr-next.ts` (the extraction only; `reviewArm`'s answers stay as they are), the line builder and its call in `packages/fleet/src/shared/auto-review.ts` (`runAutoReviewPass`), and the tests: `packages/fleet/test/unit/auto-review.test.ts` and the rule's domain test. It does not change `reviewRunLive`, the lock-holder path, the end call or `reviewEndedLine`; wave 1 owns them and has merged. Other recent briefs name `auto-review.ts` (`the-release-review-is-switched-on`, `the-review-reads-the-fixer-scope`, `the-fixer-scope-reads-every-open-pr`); rebase on `origin/main` before the PR and read any conflict in `runAutoReviewPass` rather than taking either side.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
