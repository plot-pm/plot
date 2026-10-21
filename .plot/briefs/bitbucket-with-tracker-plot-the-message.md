## Implementation brief — bitbucket-with-tracker-plot-the-message (wave 1: Message)

- **Plan (canonical):** `docs/plans/2026-10-21-bitbucket-with-tracker-plot-the-message.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2221 merged
- **Branch:** `bug/bitbucket-with-tracker-plot-the-message` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review); the plan's `Review:` is `pr`

This is the first wave. `bug/bitbucket-with-tracker-plot-adoption` waits on it and edits only `/plot-board-setup` and `/plot-init` prose, so the two share no file.

### What to build

Issue #2216, measured read-only on 2026-10-21 against ewz-kus-portal: under `Tracker: plot`, `plot-host.sh issue-list` exits 4 with `bb 1.0.0 lists no issue command … cannot be read through it`, and the sentence names no remedy. `PLOT_TRACKER="jira https://quatico.atlassian.net"` lists the same repository's EWZKUS tickets.

#2195 removed the advice to declare `Tracker` for a repository that already declared one (`packages/domain/src/rules/issue-source.ts:153`, `bbIssueCommandMissing`). The remedy that exists since #2169 is the pair `Tracker: jira <base URL>` with `Sprint owner: plot`. Make `bbIssueCommandMissing('plot')` end in that pair. Keep today's `declare the issue tracker with the \`Tracker\` config key` advice for an empty `declared`.

The sentence stays one domain function. `plot-host.sh:2338` asks it through `plot-issue-source.mjs --bb-issue-missing`, and the shell fallback string at `plot-host.sh:2339` must stay in step with the empty-`declared` arm. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The domain owns the sentence, the shell does not.** `plot-host.sh` already asks `--bb-issue-missing` on a stdin of the raw `Tracker` value. Adding a second copy of the `plot` arm in shell would be a declared duplicate that costs lines (`scripts/check-shell-lines.sh` refuses shell growth against the merge base). The fallback runs only when the ask fails, so it keeps the empty-`declared` text and gains nothing.

**`issueSource` and `sprintOwner` do not change.** `issueSource` still reads only `Tracker`, and `Sprint owner` still answers only who owns sprints (#2169). Only the sentence moves.

**Rule carried over, #2195:** `Tracker: plot` and no `Tracker` key read the same in `issueSource` (both ask the git host), but the message still tells them apart by `declared`. Keep `bbIssueCommandMissing('plot')` and `bbIssueCommandMissing('')` distinct, and keep the sentence starting `lists no issue command` — the caller writes `bb ${version}` before it.

**A declared non-`plot` value (e.g. `jira https://…`)**: the plan states no new text for it. It has already declared the key and the pair's first half, so do not add the pair advice to it. Keep today's reason-only sentence for it.

**Two plan open questions, resolved here so the slice does not stall.** The `Tracker` value is `plot` in the failing case, so the base URL is unknown to the function. Name the placeholder `<base URL>` literally. Name `Sprint owner: plot` unconditionally; the function cannot see whether the repository runs sprints, and an operator with none ignores one config line. Record both in the PR body. If either needs a person's call, write a `PLOT-BLOCKED` marker rather than guessing a third answer.

### Done when

The plan states no `## Done when` list; its Slices line is the specification: `bbIssueCommandMissing` names the working configuration under `Tracker: plot`; the shell fallback and the issue-source entry test follow. So:

- `packages/domain/test/issue-source.test.ts` (the `the sentence a bb with no issue command shows` block): replace *drops the advice where the repository already declared `Tracker`* with a test that `bbIssueCommandMissing('plot')` contains `Tracker: jira <base URL>` and `Sprint owner: plot`. It catches an implementation that only deletes the old negative assertion. Keep one test that a `jira …` declared value does not gain the pair.
- `test/reconcile/host.test.mjs:2407` (`PLOT_TRACKER: 'plot'`): its `doesNotMatch(/`Tracker`/)` assertion contradicts the new sentence and must flip to a match on the pair. It catches a domain change the bundle never picked up.
- The `--bb-issue-missing` entry test in `packages/board`: assert on the `plot` stdin, not only the empty one.
- `packages/board/src/server/entry/issue-source.ts:26` documents the entry's output. Update its example.

Plus: `plot-issue-source.mjs` is generated output. Run `pnpm build:board` to test `host.test.mjs` locally, then restore every generated path before you push (`scripts/check-no-bundle-diff.sh`). A changeset for `plot` (patch) with the description first and the `bumps:` block last, `plan:` line inside the comment. The skills touched are none, so `bumps:` may name `plot-board-setup` only if its SKILL text changes, which this slice does not do.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should change no `.sh` line count; if it does, remove shell elsewhere in the same change or write the rule in the domain.

New functions are arrows. `packages/domain` TSDoc states what the function does and returns, not the history; reasoning goes in the commit message and the plan.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/issue-source.ts`, `packages/domain/test/issue-source.test.ts`, `packages/board/src/server/entry/issue-source.ts` and its test, `skills/plot/scripts/plot-host.sh` (the fallback string only, line 2339), `test/reconcile/host.test.mjs` (the two `lists no issue command` blocks), and one changeset.

In flight beside it: `bug/bitbucket-with-tracker-plot-adoption` (waits on this branch; edits `skills/plot-board-setup/` and `skills/plot-init/`), and `jira-issue-list-limit-above-one` (recorded Started on main today; it touches the Jira issue-list path, so check `git diff origin/main --stat` for `plot-host.sh` overlap before you push).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
