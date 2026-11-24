## Implementation brief — delivery-is-measured-from-the-plan-files

- **Plan (canonical):** `docs/plans/2026-11-23-delivery-is-measured-from-the-plan-files.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3698 merged
- **Branch:** `feature/delivery-is-measured-from-the-plan-files` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one branch. Nothing waits on it and it waits on nothing.

### What to build

Plot has no figure for how fast it delivers. The research dossier of 2026-11-20 (`gap-delivery-metrics`) found no lead-time or rework metric in the source. The plan files already hold the data: each carries dated `Approved:`, `Delivered:` and `Released:` lines, and some carry `Design:` lines. The PR index holds each merged PR's `mergedAt`. This slice adds two things:

1. A domain rule `deliveryMetrics(plans, mergedPrs, weeks)` that returns one row per ISO week. It takes parsed transition lines and merged rows as values and awaits nothing.
2. A question on the existing entry point: `plot-ask.mjs metrics [--weeks N]` (default 8) that reads the plan files and the PR index and prints the rows. It calls no host.

Row content (the plan's Changelog and Design are the specification): merged PRs; plans approved; plans delivered; plans released; the median days from `Approved:` to `Delivered:` for plans delivered that week; the median days from `Design:` to `Approved:` for plans that carry a `Design:` line, in its own column; approvals per approver.

Where the pieces live today (read them before you choose a place):

- The entry point is `packages/board/src/server/entry/main.ts`. It dispatches on `argv[0]` (`release-claim`, `release-finish`, `spike`, …) and carries the usage string at about line 449. `spike` is the closest model: it prints one answer from a `PlanStore` and picks the exit code itself (`spikeAnswerOf`). Add `metrics` beside it and extend the usage line and the header comment.
- `plot-ask.mjs` under `skills/plot/scripts/board/` is a generated bundle. Commit no bundle.
- Plan records come from the `PlanStore` port (`packages/domain/src/ports/plan-store.ts`): `listPlans()` then `readPlans(files)`. A `PlanRecord` already carries `approvedRaw`, `deliveredRaw`, `releasedRaw` and `designRaw` verbatim. Parse dates from those fields; do not re-read plan text.
- The index comes from the `PrIndexStore` port (`ports/pr-index.ts`, `read(connector)`), decoded through `decodePrIndex` (`entities/pr-index.ts`, `PR_INDEX_VERSION` 8). The connector word is the host backend (`github` or `bitbucket`), the same string `entry/pr-index-lookup.ts` takes.

### The decisions the plan settles — do not re-derive them

**The index never says no.** A missing store, an unparseable store, an other-version store and a failed read all print `merged: unread`, never `0`. Only a store that decodes gives a number. This is the invariant a later consumer breaks first (`CLAUDE.md`, *A Decision Reads The Index*). Measured 2026-08-27: an empty result read as "no PRs" refused four fully-merged plans.

**Count MERGED rows only, and only a row with a parseable `mergedAt`.** A row in another state, a draft row and a MERGED row with no `mergedAt` have no merge week. Count none of them. A `complete: false` store is allowed to under-count; say nothing more than the row count it holds, and do not print it as a total claim. Never read the store with `jq` or by hand: `decodePrIndex` owns the version check.

**Medians, not means.** One plan that waited a month must not move the figure. An even count takes the mean of the two middle values. An empty week prints no median (absent, not `0`).

**A plan counts in the week of the event, not of the approval.** Lead time lands in the week of `Delivered:`. A plan with `Approved:` and `Delivered:` is the only one with a lead time. A plan with no `Delivered:` has none, and a plan with a `Delivered:` line but no `Approved:` line counts as delivered and has no lead time.

**Approvals per approver are reported, not judged.** The dossier found 660 of 708 approvals by one person; the hand-off to a second operator should show in this column. The approver is the second comma-separated field of `Approved:`. No threshold, no warning, no ranking.

**The rule awaits nothing and spawns nothing.** The domain takes readings as values (`CLAUDE.md`, *The Layering Rule*): the entry reads, the rule computes, and the entry prints. The entry calls no host and no script. A test pins that with a host double that throws on any call.

**Do not build the three open questions.** `[question-rework]`, `[question-agent-share]` and `[question-baseline]` stay open in the plan. Add no rework column, no merger-versus-person column and no baseline range. A board view of these rows is a later plan.

### Things the plan files do not hold uniformly — read them before you parse

Measured on `b51d7f814` in `docs/plans/`:

- `Delivered:` and `Released:` have more than one shape: `2026-08-15`; `2026-08-18, jwloka, verified against the source…`; `2026-04-30, v1.0.0`. Take the leading `YYYY-MM-DD` and ignore the rest.
- A plan may carry two `Design:` lines (`2026-11-06, jwloka, cli` and `2026-11-07, eins78, cli`). Check which one `designRaw` returns (first or last) before you name the design-to-approval column, and state the choice in the PR.
- A plan may carry `Rejected:` and a later `Delivered:` (`plot-undeliver.sh`). `rejectedRaw` is on the record. Decide whether a rejected plan counts as delivered, state the decision in the PR, and pin it with a test.
- A date that does not parse, or a `Delivered:` earlier than `Approved:`, yields no lead time for that plan. It must not produce a negative or `NaN` median. A test pins each.
- ISO weeks cross year ends (2026-12-31 is week 53 of 2026; 2027-01-01 is the same week). Test a week that spans a year boundary. Use UTC dates so the host's time zone changes nothing.

### Done when

The plan's `## Slices` lines name the tests: `deliveryMetrics` — weeks with and without deliveries, a median over an even count, a missing index reads unread; the entry makes no host call.

Assertions that exist because a naive implementation passes without them:

- **A week with no deliveries still prints a row** (zero counts, no median). Without it, a quiet week disappears and the series reads as shorter than asked.
- **The even-count median test uses values whose mean is not one of them** (for example 2 and 5 days give 3.5). Without it, picking the lower middle passes.
- **The unread test covers all four arms:** no file, unparseable file, other version, failed read. A single arm lets `null` read as `0` in the other three.
- **The no-host-call test uses a double that throws on any call.** A counter read after the fact passes when the double swallows the call.
- **A MERGED row with no `mergedAt` and an OPEN row are in the fixture and are not counted.**
- **`--weeks` rejects `0`, a negative number and a non-number** with a usage line and a non-zero exit. Without it, `--weeks abc` prints an empty table with exit 0.

Mutation-test two fixes: make `read` failures print `0`, and make the median take the lower middle, one at a time, and confirm the matching test fails.

Plus: a changeset. The package name must be `plot` or `@plot-pm/board` (`./scripts/check-changeset-packages.sh`). Put the description first (a sentence of at least 20 characters that names the `metrics` question) and the `bumps:` block last, with `plan: docs/plans/2026-11-23-delivery-is-measured-from-the-plan-files.md` inside that block. Declare a `minor` bump for `plot` (new capability on a shipped command). The change touches `packages/domain` and `packages/board`, so main rebuilds the shipped bundles after the merge: commit no generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 26 (`nvm use`). Never run board tests while the operator's board is open: use the `vitest related` commands the local checks print, not `pnpm test:board`.

Shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice needs no `.sh` file. If you edit one, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. Joining statements with `;` or `&&` is not a payment. The gate stores no number and has no override.

Docs: `skills/plot/scripts/README.md` has a row per script (`scripts/check-helper-table.sh` is the gate). If the `plot-ask.mjs` row lists its questions, add `metrics` there. If the plot skill's SKILL.md or README names the questions, keep them in step.

### Style

Arrow functions for everything you write (`export const f = (…) => …`). A TSDoc block states what the export does, what its parameters mean, what it returns and how it fails — not the history of the decision. Put the reasoning in the commit message and the PR. The vocabulary is **Slice**, not Wave, in new code. Absent is not false, and a failed port call is `unknown`, never `0`.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names: the choice for a plan with `Rejected:` and a later `Delivered:`, which `Design:` line the design column reads, and the tests that fail without each fix.

### Scope guard

This branch owns one new rule and its test under `packages/domain/src/rules/` and `packages/domain/test` (or the domain's existing test layout), the `metrics` branch in `packages/board/src/server/entry/main.ts` with any small module beside it under `entry/`, their tests, one changeset, and the README row if one applies. It does not touch the board UI, `fleet.ts`, `pr-refresh.ts` or any writer of the PR index, the plan parser, or any other question of `plot-ask.mjs`. It adds no port: `PlanStore` and `PrIndexStore` already answer every read. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
