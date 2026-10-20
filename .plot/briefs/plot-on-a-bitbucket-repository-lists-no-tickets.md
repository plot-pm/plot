## Implementation brief — plot-on-a-bitbucket-repository-lists (wave 1: Issue list under Tracker plot)

- **Plan (canonical):** `docs/plans/2026-10-20-plot-on-a-bitbucket-repository-lists.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2171 merged
- **Branch:** `bug/plot-on-a-bitbucket-repository-lists-no-tickets` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

Wave 1 of 2. Wave 2 (`feature/sprint-ownership-and-issue-source`) waits on this branch merging, and on the plan's Open Questions 1 and 2, which this branch does not close.

### What to build

Field test 2026-10-20 against ewz-kus-portal (Bitbucket host, Jira tickets, `Tracker: plot` in `AGENTS.md`): `plot-host.sh issue-list` exits 4 with `bb 1.0.0 lists no issue command … declare the issue tracker with the \`Tracker\` config key` (`skills/plot/scripts/plot-host.sh:2277`, in `bb_assert_issue_version`), and the board shows no tickets. The repository already declares `Tracker`. Two behaviours, both independent of which config shape wave 2 picks:

1. Under `Tracker: plot` on a host with no issue command, `issue-list` answers "nothing to list" and not a refusal.
2. The exit-4 text names the `Tracker` key only where the repository has not declared it.

Read the whole path before editing: `issueSource` (`packages/domain/src/rules/issue-source.ts`) maps `plot` or empty to `{ask: 'git-host'}`; `issue-refresh.ts` (`packages/fleet/src/shared/issue-refresh.ts`) and `fleet.ts:1972` turn an `unaskable` answer into `issueAnswer: 'unsupported'` plus an `issueAbsence` sentence. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Do not collapse "cannot be asked" into "asked, none".** The `issue-list` header (`plot-host.sh:4703`) keeps three outcomes apart: empty list = host answered none; non-zero with empty stdout = the question failed; exit 4 = this host cannot be asked. Collapsing two of them reproduces `an-outage-is-not-an-answer`. "Nothing to list" must therefore stay distinguishable from a verified-zero inbox. Plan Open Question 3 (distinct from `nobody`? empty inbox or absence sentence?) is yours to close, in the plan, with what you found; the board already renders `unsupported` with an absence sentence, so start from that arm rather than from an empty list.
- **`bb_assert_issue_version` also guards `issue-view`** (`plot-host.sh:5033`). Changing the shared helper changes both callers; the existing test loop at `test/reconcile/host.test.mjs:2352` covers both and currently asserts the `` `Tracker` config key `` text. Update it deliberately, do not delete it.
- **The shell only reads config; the rule belongs in the domain.** If the "declared or not" distinction needs a decision, ask it of the domain through a bundle (CLAUDE.md § A Shell Script Asks The Domain) instead of growing `plot-host.sh`.
- **A GitHub measurement cannot exclude a Bitbucket warning.** Under `Tracker: plot` GitHub lists GitHub issues; that arm must not change.

### Done when

The plan's checks are the specification:

- Every reader of the `Tracker` value (`trackerFor`, `tracker-resolve.ts`, the sprint gate, `plot-config.sh get "Tracker" "plot"` callers) is listed in the plan with what each does for `plot`, `jira <url>` and an absent key. Write the list into the plan.
- The `bb_assert_issue_version` refusal and the `issue-list` consumers it reaches read the same distinction: a host that cannot list versus a tracker nobody declared.
- A test names `Tracker: plot` on Bitbucket beside `Tracker: plot` on GitHub, so the two cannot drift. It catches a fix that special-cases Bitbucket and silently changes the GitHub arm, or the reverse.
- A test with `Tracker` declared proves the exit-4 text omits the advice; a test with it undeclared proves the advice stays.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. `host.test.mjs` is slow under load: run the test names you touched (`node --test --test-name-pattern=…`), not the whole file in a loop. Add a changeset (`plot: patch`, description first, `bumps:` block last with a `plan:` line pointing at this plan).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This branch touches `plot-host.sh`; growth is paid for in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section under `### Issue list under Tracker plot`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `bb_assert_issue_version` and the `issue-list` / `issue-view` Bitbucket arms in `plot-host.sh`, the `unaskable` handling in `issue-refresh.ts` and `fleet.ts` only as far as the "nothing to list" answer needs, `test/reconcile/host.test.mjs`, `packages/domain/test/issue-source.test.ts`, and the plan's Open Question 3. It does not touch the `Tracker` config shape or the sprint gate (`skills/plot-sprint/SKILL.md`): that is wave 2.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
