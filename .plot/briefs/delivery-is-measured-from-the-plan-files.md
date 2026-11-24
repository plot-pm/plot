## Implementation brief — delivery-is-measured-from-the-plan-files

- **Plan (canonical):** `docs/plans/2026-11-23-delivery-is-measured-from-the-plan-files.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3698 merged
- **Branch:** `feature/delivery-is-measured-from-the-plan-files` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`node skills/plot/scripts/board/plot-ask.mjs metrics [--weeks N]` prints one row per ISO week: merged PRs, plans approved, delivered and released, and the median days from `Approved:` to `Delivered:` for plans delivered that week. The default is the last 8 weeks. The failure it answers: Plot cannot say whether it delivers faster. The research dossier of 2026-11-20 (`gap-delivery-metrics`) found no lead-time metric in Plot's source, and 708 `Approved:` lines sit unread in the plan files.

The build has two parts, in the layering order `CLAUDE.md` settles:

1. **A domain rule**, `deliveryMetrics(plans, mergedPrs, weeks)` in `packages/domain/src/rules/` (new file, arrow function, TSDoc that states behaviour and nothing of history). It takes parsed transition lines and the index's merged rows **as values** and returns rows. It awaits nothing, imports no port and reads no file.
2. **An entry** in `packages/board/src/server/entry/main.ts`, next to `release-claim`, `merge` and `spike` in the `argv[0] ===` chain, with its `usage:` strings (both of them, near `:449`) updated. The entry reads the plan files on the default branch and the PR index, calls the rule, and prints. `skills/plot/scripts/board/plot-ask.mjs` is generated output: never edit it, and never commit a rebuild (`scripts/check-no-bundle-diff.sh`).

### Decisions the plan settles — do not re-derive them

**Lead time is approval to delivery, in the week of delivery.** A plan with `Approved:` and `Delivered:` counts once, in the ISO week of its `Delivered:` date. A plan with a `Design:` line also reports design-to-approval, in its own column. Rejected alternative: lead time from first commit or from `Started:`. The plan fixes the two dated lines every plan carries; `Started:` appears once per slice and has no single value.

**Medians, not means.** One plan that waited a month must not move the figure. An even count takes the mean of the two middle values; the plan's tests name this case.

**Merged PRs come from the index and never from a host call.** The index is `.plot/state/index/github.json` under the common git dir. Decode it with `decodePrIndex` (`packages/domain/src/entities/pr-index.ts:245`), never `jq` and never a second `JSON.parse`: `PR_INDEX_VERSION` is 8 today and a second reader drifts when it moves. Take MERGED rows and read `mergedAt`.

**A missing, unparseable or other-version index prints `merged: unread`, never `0`.** This is the invariant `CLAUDE.md` › *A Decision Reads The Index* names: the index never says no. Measured 2026-08-27 in this estate: an empty result read as *no PRs* refused four fully-merged plans. A week with no merged rows in a readable index prints `0`; an unreadable index prints `unread` for every week. The two cases need two different tests.

**Mind the placeholders in the plan files.** The template ships `- **Delivered:** <!-- YYYY-MM-DD -->` (see the comment at `packages/domain/src/workflows/rendering.ts:40`). A line holding a placeholder or an unparseable date is not a delivery. Count it nowhere and do not throw. Plans in the other four states (Draft, Design, Approved, Released-without-Delivered) must not disappear from the approved/released counts because they lack a `Delivered:` line.

**Who approved is reported, not judged.** One column counts approvals per approver, read from the second field of the `Approved:` record. The dossier found 660 of 708 approvals by one person. Print the counts and add no threshold, warning or verdict.

**The entry makes no host call.** Test it: the entry spawns nothing and sets no host token. This is the plan's own test line, and the CI spawn ratchet (`allowed=28`) must not grow.

**Open questions stay open.** The plan lists `[question-rework]`, `[question-agent-share]` and `[question-baseline]`. Build none of them. Report any answer you need to a person rather than choosing one; the plan names no rework column, no Merger-app column and no baseline week.

### Done when

The plan's slice line is the specification: `deliveryMetrics` over the plans' transition lines and the index's merged rows, and `plot-ask.mjs metrics [--weeks N]` printing the rows. Its test line names five cases: weeks with and without deliveries, a median over an even count, a missing index reading `unread`, and an entry that makes no host call. Lift these assertions, each one because a naive implementation passes without it:

- **A delivery week boundary.** A plan delivered on a Sunday and one on the following Monday land in different ISO weeks. A naive `getWeek` over local time or a year rollover (2026-12-28 to 2027-01-03 is ISO week 53 of 2026) puts them in one.
- **`--weeks N` with N greater than the history.** The rows cover N weeks ending now, including empty ones; they do not stop at the first plan.
- **A delivered plan with no `Approved:` line.** It counts as delivered and contributes no lead time. It never produces `NaN`.
- **Index version.** A store at `v: 7` prints `unread`. A fixture at the current version proves the happy path, so write one at `PR_INDEX_VERSION - 1` as well and see [[a-version-default-hides-stale-store-fixtures]] in memory: a default version in a fixture hides a stale store.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Add a changeset for the `plot` package (description first, `bumps:` block last, with `plan:` naming this plan's path), and a row for any new script in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`). The `plot-ask.mjs` row there should name `metrics`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice needs no new shell. Where it touches a `.sh` file, pay for growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&` is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new rule file and its test under `packages/domain/`, the `metrics` arm and usage strings in `packages/board/src/server/entry/main.ts`, one changeset, and the README row. It touches no board view: the plan's board-impact note says a board view of the same rows is a later plan. It adds no write to a plan file and no new field to the PR index (`PR_INDEX_VERSION` stays 8).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
