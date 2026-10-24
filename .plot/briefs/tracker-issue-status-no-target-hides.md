## Implementation brief — tracker-issue-status-no-target-hides

- **Plan (canonical):** `docs/plans/2026-10-24-tracker-issue-status-no-target-hides.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2499 merged
- **Branch:** `feature/tracker-issue-status-no-target-hides` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one wave and one branch. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh issue-status` prints `no-target` on a Jira write when no transition matches the wanted status. That one word covers two facts: the issue already holds the status (harmless), and the status exists but no transition from the current state reaches it (the tracker is behind the plan). Measured 2026-10-24 on EWZKUS-3893: delivery printed `no-target the tracker holds nowhere to put this status` while the issue sat in `Ready for Design` with six transitions, none leading to `Approving`. The summary read the same as an idempotent repeat.

The change, in the order the data flows:

1. `skills/plot/scripts/plot-host.sh`, `issue-status` arm (near `:5303`–`:5320`): on the no-match path only, `GET /rest/api/2/issue/<key>?fields=status` through `jira_ask`. Compare `.fields.status.name` with the wanted status, case-insensitively, as the transition lookup does. Print `already` on a match. Otherwise print `unreachable` with the current status and the available transition names. A successful write costs no extra call.
2. `packages/domain/src/ports/tracker.ts:80` — `StatusOutcome` gains `already` and `unreachable`. Update the `statusWrite` TSDoc (`:387`) and the paragraph at `:73` that says `written` and `no-target` are both answers.
3. `packages/domain/src/adapters/tracker/tracker-jira.ts` — map the two new words instead of folding every non-`written` word into `no-target`. `tracker-github.ts` and `tracker-fixture.ts` keep `no-target` for the GitHub no-board answer.
4. `packages/domain/src/rules/issue-status.ts:96,153,155` — extend `ReleaseSkipReason` and `TrackerWriteOutcome`, and the `WORST_LAST` ordering. `already` ranks with `written` or between `written` and `no-target`; `unreachable` ranks worse than `no-target`. Update the summary text so each word names its case.
5. `packages/board/src/server/entry/issue-status.ts:32,46` — the reason table prints one sentence per outcome. Add one for each new word, and the `unreachable` sentence carries the current status and transitions.

### Settled decisions — do not re-derive them

- **Read the status only on the no-match path.** A second `GET` on every write would double the Jira budget for the common success case. The plan proposes the no-match-only read.
- **Walking a multi-step workflow is out of scope.** The plan reports the gap and does not close it.
- **`no-target` keeps its other meanings:** no issue key, and the GitHub connector's no-board answer. Do not rename it.
- **Absent is not false.** If the status `GET` fails or returns no `.fields.status.name`, the connector cannot tell `already` from `unreachable`: exit with the failure code `jira_ask` gives and do not print either word.
- **The header comment of `issue-status` (`plot-host.sh:466`) and the comment at `:5296`–`:5300` say `no-target` is "also what a repeated write reports".** Rewrite both; a stale comment states the removed behaviour.
- **Shell budget:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. The new `GET` and branch add lines to `plot-host.sh`, and the gate stores no number and has no override. Pay for growth in the same change by removing shell elsewhere, or keep the added shell minimal (one `jq` comparison). The decision rule (`already` vs `unreachable`) is a one-line comparison; do not move it into the domain unless the line count forces it, and if you do, ask it through a bundle.

### Open questions the plan leaves to you

Decide each, record the answer in the plan's `## Design`, and say so in the PR body:

- Does `unreachable` fail the delivery summary's exit code? Proposed default: it stays a reported outcome like `no-target`.
- Does the board render the new words? `plot-deliver.mjs` and `plot-approve.mjs` print the outcome word; check `packages/board` for anything that switches on `no-target` before closing the question.

### Done when

The plan has no `## Done when` list. The specification is its `## Design › Approach` items 1–4. Assertions to add because a naive implementation would pass without them:

- A Jira fixture where the issue holds the wanted status and no transition matches answers `already`. This catches an implementation that prints `unreachable` for every no-match.
- A fixture where the issue holds another status and no transition matches answers `unreachable` and names the current status and the transitions. This catches an implementation that prints `already` for every no-match.
- A status match that differs only in case answers `already`.
- A successful write makes no status `GET` (assert the call count). This catches a read placed before the lookup.
- A failing status `GET` prints neither word.
- `worstOutcome` over `['written','unreachable','no-target']` returns `unreachable`.

Plus: add a changeset (`plot` package, description first, `bumps:` block last, `plan:` line inside the comment block). Rebuild the board artifact locally to test only; a PR diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `test/reconcile/host.test.mjs` holds the `issue-status` cases; run the names you touched, not the whole file.

### Bookkeeping

When the PR opens, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.

### Scope guard

This branch owns: the `issue-status` arm and its comments in `skills/plot/scripts/plot-host.sh`, `packages/domain/src/ports/tracker.ts`, `packages/domain/src/adapters/tracker/tracker-{jira,github,fixture}.ts`, `packages/domain/src/rules/issue-status.ts`, `packages/board/src/server/entry/issue-status.ts`, the matching tests, and the plan's `## Design`. Sprint `follow-ups-2-28-3` carries sibling branches (`plan-state-write-fails-when-a`, approved in #2502) that touch `plan-state` and `tracker-plan-state.ts`; do not edit those. If you find something the plan did not anticipate, report it rather than improvising outside scope.
