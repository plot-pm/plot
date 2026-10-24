## Implementation brief — release-deliver-and-merge-controllers-close (wave 1: Shared issues)

- **Plan (canonical):** `docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2505 merged
- **Branch:** `bug/shared-issue-close-reads-every-sibling` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** plot-review on the PR, per `Review required since`

Wave 1 of 5. The four other waves (release chain, merge path, cleanup, one parser) touch other files and wait on nothing here.

### What to build

`/plot-release` closes an issue that another unreleased plan still names. Issue #2480 (finding from #2374) lists four defects on one path, all in `packages/board/src/server/entry/deliver.ts`, release arm:

1. `unfinishedIssuesOf` (~`:190`) lists only the **Active index**. A sibling plan in **Delivered** and not yet released is ignored, so its issue closes early.
2. `plot-issue-status.sh` runs at ~`:905`, **before** the sibling read and with no skip list. `plot-plan-state.sh` receives `--skip-issue`; the status script does not. The Jira status write therefore changes a shared issue the close then skips.
3. `unfinishedIssuesOf` returns an empty set when `scripts.planMeta` fails (~`:195`). An empty set reads as "no sibling", so a failed read closes every shared issue.
4. `JSON.parse(line)` (~`:206`, and again ~`:925` for the released plan) has no guard, and runs **after** the release push has landed. A malformed line throws out of a release whose commit is already on `main`.

Fix, in the plan's terms: read Active **and** Delivered siblings through the plan directory; build one skip list and pass it to both the Jira status write and the close; on a failed read or an unparseable record, stop the issue step, print a report naming what failed, and return success for the release. Parse through the existing plan readers (`scripts.planMeta` output handled by one guarded reader), not a new bare `JSON.parse` site.

Line numbers in the plan (`deliver.ts:195/206/903/917`) are from `84b1638e4` and have drifted; the code is the same. Re-check each finding against `HEAD` before you write its test, and drop any a later commit already fixed.

### Settled decisions — do not re-derive

- **Read the plan directory, not the Active index.** `A Decision Reads The Index` in CLAUDE.md governs PR/issue answers from the host. A plan's phase is not a bought answer: it is in the file, and the Active index omits Delivered plans by construction. Reading `Plan directory` and filtering by parsed `phase` is the only source that sees both.
- **A sibling is any plan other than the released one whose `phase` is not `released` and which names the issue.** Exclude the released plan by path, as the code does now (its symlink has not moved at read time).
- **An unreadable sibling set is not an empty one.** Absent is not false: a failed `planMeta` call or an unparseable line means *unknown*, and unknown skips the close and reports. Never close on unknown.
- **The release still succeeds.** The push has landed and `Released` is booked. The issue step reports and returns 0; `summary:` carries the reason through the existing `releaseIssueSummary` reasons.
- **Open question 1 in the plan** (domain rule over plan rows versus staying in `deliver.ts`): prefer the domain. `releaseIssueDecisions` already lives in `packages/domain/src/rules/`; put the skip-list rule beside it as a pure function over parsed rows, so a unit test needs no board. The controller keeps only the read.
- Rules carried over from this repo: arrow functions for every function you write; TSDoc states behaviour, not history; the layering rule (controller calls domain, never spawns); `plot-*.sh` are reached only through the `scripts` port.

### Done when

The plan's `## Done when`-equivalent for this slice is the slice line plus the Changelog bullets 1 and 2. Assertions that exist because a naive fix passes without them:

- A **Delivered** unreleased sibling keeps the shared issue open. Catches a fix that only widens the Active read by adding a second directory name.
- The Jira status write receives the skip list. Catches a fix that patches only `plot-plan-state.sh`'s flags. Assert on the argv `plot-issue-status.sh` receives, or on what the tracker adapter writes; do not assert on the summary line alone.
- `planMeta` failing leaves the issue **open** and the exit code `0`. Catches a fix that throws, and one that keeps returning an empty set.
- An unparseable `planMeta` line does the same, with the report naming the file. Catches a fix that wraps only one of the two `JSON.parse` sites.
- A plan whose only sibling is `released` still closes. Catches an over-broad skip.

Write each as a failing test first, named for the finding (#2374).

Plus: a changeset (`plot` or `@plot-pm/board` package, description first, `bumps:` block last, optional `plan:` line); no built bundle in the diff (`scripts/check-no-bundle-diff.sh`). Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in `CI suites` run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shipped shell grows over its merge base; if you touch `plot-issue-status.sh`, remove an equal number of lines elsewhere or take the rule into the domain and ask it through a bundle. Prefer the latter.

### Bookkeeping

Open the PR with `plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Keep the finding list (#2374 and its four defects) in the PR description so a reviewer checks each against a diff.

### Scope guard

This branch owns `packages/board/src/server/entry/deliver.ts` (release arm), `packages/domain/src/rules/issue-status.ts` and its neighbours, the tests that name them, and one changeset. It does not touch `release-chain.ts`, `pr-merge-dest`, `approve.ts`, `gate.ts`, `same-commit.ts`, remote URL parsing or `CHANGELOG`: those belong to the other four slices of this plan. If you find something the plan did not anticipate, report it rather than improvising outside scope.
