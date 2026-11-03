# Testability juror: pr-review accepts a plot/review status from any writer

Position: amend

## Summary

The defect is real and a shell contract test can show it fail on origin/main with a two-line fixture change. The plan names the wrong test file, does not say which existing fixtures break, and leaves the one decision that sets where the failing test lives (shell filter or domain rule) open in two contradicting sentences. The slice-PR rule does not read `pr-review` at all, so the plan's domain-side claim has no test that could fail.

## Findings

### 1. The stub can model creators, but the named file is the wrong one

- `pr-review` has its own contract file, `test/reconcile/host-pr-review.test.mjs`, whose header says it is kept apart from `host.test.mjs` "whose whole file runs for minutes" (lines 1-4). `host.test.mjs` holds only a Bitbucket `pr-review` fixture (lines 106-111). The lens line and any brief that says `host.test.mjs` sends the agent into the slow file.
- `ghStub` in `host-pr-review.test.mjs:25-38` serves `statuses` as an arbitrary JSON array through `printf`. Adding `creator: { login, id, type }` to a status object needs no stub change. A forged-after-failure fixture is `[{context:'plot/review', state:'success', creator:{login:'jwloka',type:'User'}}, {context:'plot/review', state:'failure', creator:{login:'plot-review[bot]',type:'Bot'}}]` (the API lists newest first).
- The stub matches the exact argv `api repos/{owner}/{repo}/commits/abc123/statuses` (line 31) and answers `exit 9` to anything else. If the fix adds `--paginate`, `?per_page=100` or a second `gh api apps/...` call, every GitHub test in the file fails with `pr-review: the read failed`, not with an assertion. The slice must extend the stub arms in the same commit.
- Real shape, read today: PR #3067's head carries two `plot/review` statuses, both `creator.login = "plot-review[bot]"`, `creator.id = 342578638`, `type = "Bot"`. The bot user id is not the App id `5317669` in `Review app`. `gh api apps/plot-review` answers `{"id":5317669,"slug":"plot-review"}`. So the comparison key must be the login (or the slug), and the test fixture must use the login.

### 2. Does each named test fail on origin/main?

- The one named test ("posts a forged `success` after an App `failure` and reads the refusal") fails on origin/main: `plot-host.sh:4395` takes `[... | select(.context == "plot/review")][0]`, so it answers `state: "success"` for the fixture above. It passes after a writer filter. This is a sound fail-before test, provided the expected output is fixed in the plan (see open decision A).
- The test's result depends on `## Plot Config`. `plot-config.sh:290-291` reads `PLOT_REPO_ROOT`, else `git rev-parse --show-toplevel`. `prReview` in `host-pr-review.test.mjs:40-49` spreads `process.env` and runs with the repo as cwd, so the test reads this repository's real `Review app: 5317669 ...` line, and under a worker env it reads whatever `PLOT_REPO_ROOT` names. The new test must run against a temp root with its own `CLAUDE.md` and set `PLOT_REPO_ROOT` to it explicitly, or it passes or fails by accident of where it runs.
- No test in the repo has a `creator` field: `git grep creator` over `test/`, `packages/*/test` and `plot-host.sh` finds zero hits. After the fix, every existing GitHub fixture with a `plot/review` status reads as a foreign writer. That breaks at least `host-pr-review.test.mjs:52` (expects `failure`), `:143` (expects `pending` with description and time) and `scan-review-bypass.test.mjs:180` ("a passing plot/review is not reported", fixture at lines 47-53). Whether these break depends on open question 4 (no `Review app` key): `scan-review-bypass` runs in a sandbox repo whose config has no such key. The plan names none of these, so an unattended agent finds them as red CI.

### 3. The domain side has no test that can fail before the change

- `merge` (`packages/domain/src/workflows/merge.ts:209-212`) refuses `review-not-passed` for every `state !== 'success'`. `release-approve.ts:92` does the same as `review-missing`. A domain test feeding a new state word (`foreign`, or `absent`) refuses on origin/main already. It cannot fail before the change, so it proves nothing about the fix. Only the shell test proves the fix if the shell filters.
- The plan says (Design, Layering) "the identity comparison is a rule the domain owns, and `pr-review` stays a reading that reports the writer". The Approach paragraph says "The GitHub arm ... keeps a `plot/review` status only when its writer matches". These are two different designs with two different failing tests. Under the Layering sentence, `PrReviewReading` (`ports/host.ts:150-161`) gains a `writer` field, `merge` compares it to the configured identity, and the fail-before test is a `workflows-merge.test.ts` case `review({ state: 'success', writer: 'jwloka' })` expecting `review-not-passed`, which passes on origin/main today. Under the Approach sentence, the domain does not change and the fail-before test is shell-only.
- The slice-PR rule does not read `pr-review`. `slicePrNext` (`rules/slice-pr-next.ts:181, 227, 324`) and `release-prepare.ts:199, 260-267` read `plotReview` from the PR index, and `pr-refresh.ts:1180` fills it from `pr-list --rich`, whose jq at `plot-host.sh:4803` takes `[.statusCheckRollup[] | select(.context == "plot/review")][0]`. That rollup carries no creator in `gh --json statusCheckRollup`. The plan's Motivation line "the slice-PR rule read[s] the answer of `pr-review`" is false, and the fix leaves the index channel writer-blind. A forged `success` there selects a merge that `mergeAt` then refuses (safe after the fix); a forged `failure` there starts a fix agent through the HIGH arm (`slice-pr-next.ts:227`) and `revert-start-world.ts:167`. The plan must either scope this out by name or add a slice and a test.
- The review arm (`packages/board/src/server/entry/review.ts:303-306` and `:498-505`) reads `prReview` before it writes `pending` and before it writes the verdict, and compares `description` to `run <runId>`. If the shell filters foreign statuses out, a forged `pending` with another run id can no longer supersede a run, and a forged `failure` can no longer block one. That is a behaviour change with no named test. `packages/board/test/unit/review.test.ts` is the place.
- `review-bypass.ts` (board entry `:62`, domain rule `rules/review-bypass.ts:36`) reports a merged PR whose review is not `success`. A merged PR whose only `success` is foreign becomes a reported bypass after the fix. That is the right answer and needs one case in `scan-review-bypass.test.mjs`.

### 4. Bitbucket arm

- The Bitbucket arm lives in `plot-host.sh:4379-4392` and folds through `plot-jenkins-pr-checks.mjs review`; Bitbucket build statuses carry no author field, and the writer is the account in `BITBUCKET_REVIEW_USER` (`plot-host.sh` header, around line 592). "States which writer it trusts ... in a test" can only be a test that asserts output unchanged; a header comment is not testable. The plan should say the Bitbucket test asserts that the arm's answer does not change, and name the residual risk.

## Amendments required

1. Name `test/reconcile/host-pr-review.test.mjs` as the shell test file, not `host.test.mjs`.
2. Pick one design and delete the other sentence: either the shell filters by writer (domain unchanged, test is shell-only), or the shell reports `writer` and `merge`/`release-approve` compare it (domain test in `workflows-merge.test.ts` and `workflows-release-approve.test.ts` that fails on origin/main because the field is ignored). Name the fail-before test for the chosen design.
3. Fix the expected output of the forged-success test: name the exact JSON (`state` word and any new field) the test asserts.
4. Require the new test to set `PLOT_REPO_ROOT` to a temp dir holding a `CLAUDE.md` with a `Review app` line, and a second case with no such line, asserting the behaviour open question 4 picks.
5. List the existing fixtures that must gain `creator: {login:'plot-review[bot]', type:'Bot'}`: `host-pr-review.test.mjs:52, :143`, `scan-review-bypass.test.mjs:47-53`, and any board or domain fixture that reaches the shell `pr-review` arm.
6. Correct the Motivation claim about the slice-PR rule, and either scope the index channel (`plot-host.sh:4803`, `slicePrNext`, `release-prepare`) out by name with a follow-up issue, or add it to the slice with a test.
7. Add one case to `packages/board/test/unit/review.test.ts`: a foreign `pending` with another run id does not supersede the run (or does, if the design keeps it visible), so the review arm's change is pinned.
8. State that the comparison key is `creator.login` and name its source. A test fixture cannot be written until this is fixed.

## Decisions that need a person

- A. Where the identity rule lives: shell filter or domain comparison (amendment 2).
- B. Source of the bot login: a new config value (for example the App slug beside the id), a `gh api apps/<slug>` call (needs the slug anyway, since there is no public lookup by id), or a JWT call to `GET /app` through `plot-github-app.mjs`. The last one is node `fetch`, which the `gh` stub cannot model, so it needs a different test seam.
- C. Behaviour with no `Review app` key (plan open question 4): this decides whether `scan-review-bypass.test.mjs` and every sandbox fixture change.
- D. Whether the index channel (`statusCheckRollup`) is in scope.

## What I ran versus read

Ran (read-only): `git show origin/main:` and `git grep` over `plot-host.sh`, `plot-config.sh`, `host-pr-review.test.mjs`, `host.test.mjs`, `scan-review-bypass.test.mjs`, `merge.ts`, `release-approve.ts`, `ports/host.ts`, `slice-pr-next.ts`, `release-prepare.ts`, `pr-refresh.ts`, `review.ts`, `review-bypass.ts`; `gh issue view 3072`; `gh api repos/{owner}/{repo}/commits/<head of #3067>/statuses` (creator shape); `gh api apps/plot-review` (id and slug).

Only read, not run: no test suite was run. The claim that the forged-success fixture fails on origin/main follows from the jq at `plot-host.sh:4395`, not from an execution.
