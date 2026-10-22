## Implementation brief — reconcile-23-tells-a-delivered-plan

- **Plan (canonical):** `docs/plans/2026-10-22-reconcile-23-tells-a-delivered-plan.md` on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2335 merged
- **Branch:** `bug/reconcile-23-tells-a-delivered-plan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Single slice, single wave (`Hint`). Nothing waits on it and it waits on nothing. Its sibling `reconcile-23-tells-a-released-plan` (#2283) is merged.

### What to build

Section 23 of `skills/plot/scripts/plot-reconcile-scan.sh` prints the wrong `decide:` line for a Delivered plan on a Jira tracker that declares no `Tracker released status`. Measured on ewz-kus-portal (main `da789acff`, field test round 7, issue #2326): `ewzkus-3874-zevvy-odata-adapter` and `ewzkus-3878-contractpast-nachladen` are both Delivered and both read `decide: release the plan to close it through the tracker, close it by hand, or record why it stays open`. Releasing either plan moves nothing, because a Jira issue receives only a status word and ewz declares none. The hint offers a repair that cannot work.

The cause is the arm order at `plot-reconcile-scan.sh:3138-3144`. The first test is `[ "$oi_phase" != released ]`, which prints the release hint without reading `$oi_released_status`. Only the Released arm below it reads that variable. #2283 fixed the Released arm and left this one.

The change: in the non-Released arm, print a new cause line when `oi_scheme` is `jira` and `oi_released_status` is empty. The line says no `Tracker released status` is configured, so releasing this plan would not move the Jira issue, and that the reader can close it by hand or record why it stays open. Every other case keeps today's release hint. `oi_scheme` and `oi_released_status` are both set before the loop (`:3053`, `:3094`), so no new read is needed. Update the section's header comment (`:2996-3004`) so it names the Jira Delivered case — it currently says only a Delivered plan's release "can still move the issue", which is false for this case. The plan at `docs/plans/2026-10-22-reconcile-23-tells-a-delivered-plan.md` is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The condition is `scheme == jira` AND no released status — not "no released status" alone.** The two trackers record a release differently, and that is the measurement that decides it. Jira: `planStateWrite` in `packages/domain/src/adapters/tracker/tracker-jira.ts:282` returns `no-target` and writes nothing; the status word comes from `Tracker released status` through `plot-issue-status.sh`, so an empty config means no write at all. GitHub: `githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:78`) pushes `issue-close` for the `released` phase and never reads `Tracker released status`. A release closes a GitHub issue with no config. A condition on the empty config alone would tell a GitHub user their release cannot close the issue, which is false. (The plan cites `tracker-jira.ts:279`; the function now sits at `:282`. The behaviour is unchanged.)

**The GitHub guard test stays as it is.** `test/reconcile/scan.test.mjs:4551-4572` ("section 23 reports a Released and a Delivered plan naming an open issue") uses the GitHub host stub with no key and asserts the release hint, under the comment `DELIVERED KEEPS TODAY'S HINT`. The sibling plan made that choice for GitHub on purpose. Do not edit that test, and do not loosen its regex. If your change breaks it, the condition is wrong.

**A declared status keeps the release hint, even on Jira.** With `Tracker released status` set, a release writes that word, so releasing a Delivered plan can still move the issue. Only the empty case is the new arm. The Released-plan arms (`:3140-3143`) are already right and stay untouched.

**Absent is not false.** `cfg "Tracker released status" ""` returning empty means *not configured*. The sibling brief carried the same rule for `issue-view`: read the exit code, not the emptiness, and never read a failed lookup as closed. The per-key `issue-view` loop and its exit-4 / non-zero split (`:3114-3125`) are not part of this change.

### Done when

The plan's `Hint` slice line and its Changelog entry are the specification: a Delivered plan on a Jira tracker with no `Tracker released status` is told the cause, and a GitHub Delivered plan keeps the release hint.

Lift these assertions, because a naive pass would satisfy the existing tests without them:

- **A Jira Delivered plan, key open, `Tracker released status` undeclared, asserts the new sentence** and `assert.doesNotMatch` on `decide: release the plan`. Without the negative assertion, a fixture that accidentally hits the GitHub path passes.
- **The same fixture with `Tracker released status` declared asserts today's release hint.** This proves the condition reads the key rather than the scheme alone. Mutation check: change the condition to `[ "$oi_scheme" = jira ]` only; this test must fail.
- **A GitHub Delivered plan with no key keeps the release hint** — this is the existing test at `:4551`, unchanged. Mutation check: drop the `jira` half of the condition; that test must fail. If it still passes, the test does not exercise the arm: the fixture must make the two arms give different answers.

Build the Jira fixture on `jiraIssueFixture` (`test/reconcile/scan.test.mjs:~4940`, used by the tests at `:5013-5170`). Its default plans are all Released, so add the Delivered plan through its `extraPlans` argument, keyed by path under `plans/`. Pass the declared status through the fixture's `CLAUDE.md`, as `:4603` does for the GitHub case. New tests are arrow functions in any helper you write (CLAUDE.md, *Arrow functions, not declarations*).

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI on every PR; do not run `test:e2e` locally. Add a changeset: description first, `bumps:` block last, package `plot`, `patch`, with `plan: docs/plans/2026-10-22-reconcile-23-tells-a-delivered-plan.md` in the comment block; run `./scripts/check-changeset-packages.sh` after.

**The shell gate applies.** `scripts/check-shell-lines.sh` counts non-comment, non-blank lines and refuses a PR whose shell under `skills/` is longer than at its merge base. It stores no number and has no override. The obvious edit adds an `elif` and an `echo`, two counted lines, and fails the gate. Pay for the growth in the same change. One route that nets about zero, and answers the plan's open question about a shared helper: fold the no-status wording into one arm and let a variable carry the one word that differs (`again` for a Released plan, empty for a Delivered one), so the three arms stay three. Another route is removing shell elsewhere in section 23. Choose, and say which in the PR body. Do not move this into the domain just to dodge the count: the decision is a one-line condition, and the corpus tier is for rules duplicated on purpose.

### Bookkeeping

Open the PR through the controller once the first real commit exists, and push that commit as soon as it exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-22-reconcile-23-tells-a-delivered-plan.md:49`). Do not edit `State:`; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns section 23 of `skills/plot/scripts/plot-reconcile-scan.sh` (about `:2930-3164`; no other numbered section) and the section-23 block of `test/reconcile/scan.test.mjs` (`:4545-5270`), plus the changeset. It touches no domain code and no generated bundle.

No other branch is in flight against these files as of this brief: `git log --since=2026-10-22` shows no commit to either file, and no remote ref exists for this branch. `main` was `a7f9afbcc` when this was written.

If you find something the plan did not anticipate — for example a Jira fixture where `oi_scheme` is not `jira` on a declared Jira tracker — report it rather than improvising outside scope.
