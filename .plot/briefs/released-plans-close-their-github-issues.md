## Implementation brief — released-plans-leave-their-github-issues (wave 1: Close on release)

- **Plan (canonical):** `docs/plans/2026-10-23-released-plans-leave-their-github-issues.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2361 merged
- **Branch:** `bug/released-plans-close-their-github-issues` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/board-hides-released-issues-from-assigned`, is independent in files (board package) but needs the same notion: an issue's remaining unfinished plans. Build that property in the domain here only if the close rule needs it; wave 2 reuses it rather than writing a second one.

### What to build

After `/plot-release 2.28.0` on 2026-10-22, 65 plans read `State: Released` and 63 of the issues they name stayed open on GitHub (issue #2355). Every `plot-deliver.sh --release` run ended `tracker=skipped` and `plot-issue-status.sh` ended `summary: tracker=none`.

Two paths disagree about what Released owes a GitHub issue:

- `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts`) returns `[]` when the phase's status word is empty. This repo sets no `Tracker released status`, so the status path owes nothing.
- `githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts`) pushes `issue-close` for `phase === 'released'` and never reads that key.

The fix makes the release path reach the plan-state write on a GitHub tracker whatever the key says. The key keeps its meaning for trackers that need a status word. The entry is `packages/board/src/server/entry/plan-state.ts` (`planStateWrites`, `trackerWriteSummary`), bundled as `plot-plan-state.mjs`. Add to the domain a rule that decides which issues a release closes (skip an issue another not-yet-Released plan also names), and the closed / left-open summary line with a reason for each left open: another plan unfinished, no issue number, tracker unaskable, write failed.

### Settled by the plan — do not re-derive

- **The decision is a domain rule, not shell.** `plot-deliver.sh` and `plot-issue-status.sh` collect and print; the bundle asks the rule. Do not add a `gh issue close` call in shell: `plot-host.sh` is the one place that talks to the host CLI and `scripts/check-host-cli-callers.sh` gates it.
- **Another unfinished plan names the issue → leave it open.** An issue shared by two plans closes only when the last of them is Released. "Unfinished" means any phase before Released, read from `plot-plan-meta.sh` over `docs/plans/*.md`.
- **The summary reports counts, not just a word.** `summary: tracker=<outcome>` stays for existing readers (`trackerWriteSummary`, the `summary: tracker=` parse in `issue-status.ts`); the closed / left-open line is added beside it and does not replace it.
- **A write that fails is reported, never raised.** The plan is already Released; the tracker holds a copy of one fact. Keep `plot-issue-status.sh`'s contract: exit 0 on every write outcome.
- **The tracker port rules carry over:** `trackerNone` answers `unaskable` on every operation including the write; a missing tracker is not a close. Absent is not false.
- **Typed words, arrows.** New domain code is arrow functions with factual TSDoc; the terminology follows the specs (Slice, Agent).

### Open questions to answer first (the plan lists them; answer them in the PR)

1. **Why `tracker=skipped`?** `grep` in `skills/plot/scripts` and `packages/domain/src` finds no source for the literal `tracker=skipped` outside `plot-host.sh` capability notes. Find which caller prints it, and whether the git-host-issues fallback (`trackerGitHost`, `tracker-resolve.ts:124`) reaches `planStateWrite` or the release path returns before it. The fix goes where that return is.
2. **Non-GitHub trackers with an empty `Tracker released status`:** the issue names GitHub only. Leave other trackers unchanged and say so.
3. **The issue inbox view:** the issue says only *Assigned to you*. Leave the inbox to wave 2 / a follow-up.

### Done when

The plan's `## Changelog` and Slices line are the specification: the release path closes issues on a GitHub tracker without `Tracker released status`, skips an issue another unfinished plan names, and reports closed and left-open counts. Plus assertions a naive implementation would pass without:

- **Shared issue stays open.** Two plans name issue 7, one Released, one Approved → no `issue-close` for 7, and the summary names "another plan unfinished". Catches a rule that closes per plan.
- **Empty key, GitHub tracker, Released plan → `issue-close` is issued.** Catches a fix that only edits the adapter and leaves `issueStatusWrites` as the gate.
- **A plan naming no issue → `no-target`, counted as left open with that reason, no crash.**
- **Failed write → counted as left open with reason, exit 0.**
- **A non-GitHub tracker with an empty key still writes nothing.**

Gates: add a changeset (description first, `bumps:` block last; package `plot`, skill `plot-release` / `plot-deliver` as touched; `./scripts/check-changeset-packages.sh`). The bundles under `skills/plot/scripts/board/` are generated: do not commit a rebuild (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through the bundle. The gate stores no number and has no override.

Update the `## Model Guidance` row of `plot-release` SKILL.md step 5b / step 4 if the steps change, and `skills/plot/scripts/README.md` if a script's contract changes.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`.

### Scope guard

This branch owns: `packages/domain/src/rules/issue-status.ts`, `packages/domain/src/adapters/tracker/tracker-plan-state.ts` (only if the adapter needs it), `packages/board/src/server/entry/plan-state.ts` and `issue-status.ts`, `skills/plot/scripts/plot-deliver.sh` / `plot-issue-status.sh` (summary line only), `skills/plot-release/SKILL.md`, and their tests.

It does not own `packages/board/src/app/lib/agent-rows/waiting-view.ts` or any board view: that is `bug/board-hides-released-issues-from-assigned`. Other branches in flight on the same tracker files were not checked at brief time; run `/plot-pulse` before editing `tracker-*.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
