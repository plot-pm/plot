## Implementation brief — plot-reap-yes-deletes-a-different (wave: Unknown host answers)

- **Plan (canonical):** docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2828 merged
- **Branch:** `bug/plot-reap-names-an-unknown-host-answer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (plot-review gate)

This is wave 2 of 4. Wave 1, `bug/plot-reap-pins-every-tip-it-deletes` (recoverable deletes, pinning), merged via PR #2850 — this wave builds on code that already pins every tip before a local delete. Waves 3 (`bug/plot-reap-keeps-commits-after-the-merge`) and 4 (`bug/plot-reap-yes-acts-on-the-recorded-run`) both touch `runBranchKind` and `sweepable.ts` again and wait on this wave merging first — the plan's Notes section is explicit that the four slices gate in merge order to keep them from colliding.

### What to build

`plot-reap --yes` currently prints "unlanded work — no merged PR" for a branch whenever the host failed to answer at all — a rate limit, a transient failure, an `unknown` PR-merged answer — exactly the same row it prints for a branch that is genuinely unmerged. The operator cannot tell a degraded answer from a real one, and issue #2825's `migration-abw-rechnungsempfaenger` row is this bug: dry-run saw a degraded answer and printed `keep`, the `--yes` run saw the true answer and printed `deleted`.

The fix: carry the host's answer as a `MergedAnswer` (`merged | not-merged | unknown`) plus a refusal kind, instead of collapsing it to a boolean `hasMergedPr`. Every case where the host did not actually answer "not merged" must produce its own keep reason (`host-unknown` or `host-throttled`), never the "unlanded work" reason, which is reserved for a genuine `not-merged` answer.

### The decisions the plan settles — do not re-derive them

**Four distinct cases reach the new keep reasons, not just "the host failed":**

1. **An `unknown` answer.** `pr-merged` already prints `unknown` or exits 3 today; the port already answers `MergedAnswer 'unknown'` (`packages/domain/src/adapters/host/host-shell.ts:309-323`). Both paths clear `lastRefusal()`, so this reading carries no refusal kind → `host-unknown`.
2. **A failed port result** (`!hostMerged.ok`, read at `reap.ts:1005-1006`). This is not itself a `MergedAnswer` — read `lastRefusal().kind` (`host.ts:87-88`): `throttled` and `secondary` → `host-throttled`; `failed` → `host-unknown`.
3. **A failed call with empty stderr.** `miss_or_unknown` (`plot-host.sh:658`) answers `not-merged` today — this is the actual defect being fixed. Change it to answer `unknown`, so the port reports `unknown` → `host-unknown`.
4. **A failure whose stderr matches only the bare `not found`.** `is_lookup_miss`'s bare `not found` alternative (`plot-host.sh:2293-2296`) currently matches both a real PR-not-found miss AND unrelated failures like "repository not found" / "404 Not Found", which both get read as `not-merged`. Narrow the miss test to only the two PR-specific phrases (`no pull requests found|match`, `could not find … pull request`); every other failure answers `unknown`. This is safe because an absent PR is a *successful* empty list on both backends (`plot-host.sh:4238` GitHub, `:4257` Bitbucket) — it never goes through the failure path at all. **Do not touch `is_lookup_miss` itself** — `miss_or_exit3` and three other call sites (`:2348,4367,4379`) read it for unrelated questions; `miss_or_unknown` has exactly two callers, both inside `pr-merged` (`:4241,4260`), and only those call sites change behavior.

**Why a boolean can't express this:** `firstBranchRefusal` (`packages/domain/src/rules/sweepable.ts:38,73,99`) takes a boolean `hasMergedPr` today, so "merged" and "we don't actually know" are indistinguishable at the type level — that's the root cause, not an edge case in the existing logic. The fix is a type change (boolean → `MergedAnswer` + refusal kind), not a new conditional bolted onto the existing boolean path.

**Row text:** `keep — the host could not answer` for `host-unknown`, `keep — the host could not answer, rate-limited` for `host-throttled`. Never fall through to "unlanded work — no merged PR" for either.

**Scope boundary — do not implement slices 1, 3, or 4.** Slice 1 (pinning/recoverability) is already merged and is not this branch's concern beyond relying on it existing. Slices 3 (commits-after-merge) and 4 (recorded dry-run) are separate branches that have not started yet; this plan's Notes explicitly call out that all three remaining slices touch the same two files and must not run concurrently. Keep this change to exactly what slice 2 describes: `LocalBranchReadings`, `branchSweepProblems`/`sweepable.ts`, the `reap.ts` reading of `lastRefusal().kind`, and `plot-host.sh`'s `miss_or_unknown`.

### Done when

The plan's `## Done when` is expressed through its Tests section for slice 2 — treat these as the specification:

- **Domain unit** (`packages/domain/test/sweepable.test.ts`): `branchSweepProblems` with an `unknown` host answer returns `host-unknown`, not `no-merged-pr`; with a failed reading of kind `throttled` or `secondary` returns `host-throttled`.
- **Board unit**: a fake host whose `prMerged` returns `!ok` with `lastRefusal()` of kind `throttled` gives a `rate-limited` row; kind `failed` gives `host-unknown`.
- **Contract** (`test/reconcile/host.test.mjs`): `pr-merged` answers `unknown` for a `gh` stub that fails with empty stderr AND for one that fails with "repository not found" — and still answers `not-merged` for "no pull requests found" (this is the regression guard that proves the miss-test narrowing didn't overreach).
- **Contract** (reap): a `gh` stub that answers 429 for one branch gives a row reading `keep — the host could not answer` that does NOT match `/unlanded work/`; same assertion for a stub failing with empty stderr.
- **Must stay green, unchanged:** `test/reconcile/reap-failed-readings.test.mjs:128` (a stub answering `[]`, so legitimately `not-merged`) and `sweep.test.mjs:217` ("an unreachable host deletes nothing").

Each assertion catches a specific regression a naive fix would miss: the `host.test.mjs` "repository not found" case exists because a looser fix could narrow the miss test too far and start misreading unrelated host errors as `unknown`; the `reap-failed-readings.test.mjs` and `sweep.test.mjs:217` checks exist because it's easy to accidentally also change the behavior of a *genuine* not-merged answer while fixing the degraded-answer path.

Plus the repo's standing gates: build artifacts, changeset, platform constraints. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it names the tests that touch your changed files, the related tests and typecheck of the changed package, and the relevant gate tests and `scripts/check-*.sh`. The suites in `CLAUDE.md`'s `CI suites` key run in CI on every pull request; do not run the full `test:e2e` locally (it is CI's gate, not a local one — see CLAUDE.md § Testing).

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice touches `plot-host.sh` (`miss_or_unknown`) — if the change grows that file's command count, pay for it by removing shell elsewhere in the same change, or move the rule into the domain and reach it through a bundle. The gate counts commands, not lines; joining statements with `;`/`&&` or folding `fi`/`done` onto the prior line is not a payment.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the plan's wave heading as title, plan + brief in the body. Once created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (under "### Unknown host answers"). Push the first real commit as soon as it exists.

### Scope guard

**This branch owns:**
- `packages/domain/src/rules/sweepable.ts` (the `MergedAnswer`/refusal-kind plumbing, `branchSweepProblems`)
- `packages/domain/src/adapters/host/host-shell.ts` (only as needed to confirm/expose the existing `MergedAnswer`/`lastRefusal()` plumbing — it already does most of this)
- `packages/board/src/server/entry/reap.ts` (reading the new answer shape at the `runBranchKind` site, `:1005-1023`)
- `skills/plot/scripts/plot-host.sh` (`miss_or_unknown` at `:658`, and its two `pr-merged` call sites `:4241,4260`)
- `packages/domain/test/sweepable.test.ts`, relevant board unit tests, `test/reconcile/host.test.mjs`, reap contract tests

**Other branches in flight on this plan, verified at dispatch time:** `bug/plot-reap-pins-every-tip-it-deletes` (slice 1) is merged — no conflict risk, just a dependency. `bug/plot-reap-keeps-commits-after-the-merge` (slice 3) and `bug/plot-reap-yes-acts-on-the-recorded-run` (slice 4) have not started; per the plan's Notes, they will also touch `reap.ts`'s `runBranchKind` and `sweepable.ts` once dispatched, so finishing and merging this branch promptly reduces their rebase risk.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
