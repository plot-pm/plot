## Implementation brief — reports-name-their-cause-and-ci-selects-their-tests (wave 2: Jenkins sha read)

- **Plan (canonical):** docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3611 merged
- **Branch:** `bug/the-jenkins-sha-refusal-names-its-cause` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch has no wave dependency. The plan's five slices are independent (Notes: "no slice waits on another"). The other four touch `release-chain.ts`, the desk-dirt and reaper files, `local-checks.ts` with `ci-job-map.jq`, and `build.mjs`. None touches `plot-host.sh` or `host.test.mjs`.

### What to build

Issue #3160, second half. A Jenkins sha read that times out prints the auth text, and a two-path failure reports the wrong path. Both are in `jenkins_sha_runs` and `jen()` in `skills/plot/scripts/plot-host.sh`:

- `jen()` (`:3868`) writes `jen api gave no answer within ${PLOT_JEN_BOUND_S} s` on exit 143 (`:3879`). The line has no `error:` prefix. `jenkins_sha_runs` re-emits only a line matching `^error:` (`:2054`), then prints `run \`jen auth login\`` (`:2062`). A timeout therefore shows the auth advice.
- The loop (`:2030-2032`) calls `plot_tmpfile err_tmp` once per path, so after the loop `err_tmp` holds the stderr of the root path only. An expired SSO redirect on the branch path followed by a 404 on the root path reports the 404.
- Only `jenkins_sha_runs` sets `PLOT_JEN_BOUND_S` in shipped shell, so the new timeout line reaches no other refusal.

The change:

1. `jen()` writes the timeout as `error: jen api gave no answer within ${PLOT_JEN_BOUND_S} s`.
2. `jenkins_sha_runs` makes one stderr file per path before the loop. The refusal shows the first `error:` line of each path that has one, labelled by path, branch path first.
3. Where the line is a timeout, the refusal names the bound and `PLOT_JENKINS_SHA_BOUND_S` and does not print the `jen auth login` line.

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The timeout joins the `error:` reader. It does not get a second reader.** The reader at `:2054` already carries every other `jen` failure into the refusal. Prefixing the timeout line is a one-word change in `jen()`. A separate timeout branch in the refusal would be a second place that knows `jen`'s wording.

**One stderr file per path, not one file appended to.** A single appended file cannot say which path wrote which line, and the refusal must label by path. `grep -m1 '^error:'` per file gives each path's first error line.

**Shell growth is paid in the same change.** `scripts/check-shell-lines.sh` refuses a pull request whose shipped shell under `skills/` is longer than at its merge base. It counts commands, not lines. Joining statements with `;` or `&&`, or folding `fi`/`done` onto the previous line, is not a payment. The gate stores no number and has no override. Remove shell elsewhere in the same change, or move a rule into the domain and ask it through a bundle.

**Rules carried over:**

- Absent is not false: a refusal for a path that wrote no `error:` line shows nothing for that path. It must not invent a line.
- Read the exit code, not the emptiness: the timeout is exit 143 from the killed process group in `jen()`. Do not infer a timeout from empty stderr.
- `jenkins_sha_runs`'s other refusals keep their wording: `unknown command: api` (jen 0.4.0), `jen is not installed`, and "Jenkins has no branch '<b>' indexed". The new causes change only the generic "did not answer" arm.

### Done when

The plan's `## Done when` list is the specification. This slice owns the Slice 2 test list in the plan's Design, all in `test/reconcile/host.test.mjs`. "Fails today" marks a case that fails on `main`. "Pins" marks a case that passes on `main` and holds the behaviour. Write the failing cases first and watch them fail for the stated reason.

- **Timeout.** `PLOT_JENKINS_SHA_BOUND_S=1` and `apiSleep: 5`. The read exits 4, stderr names the bound, stderr has no `jen auth login`. Elapsed time is under 2 × bound + 2 s (4 s). The read kills two calls, branch path then root path, so it waits at least 2 s. Fails today. The elapsed bound catches an implementation that waits out the 5 s sleep.
- **SSO order.** An expired-SSO stderr on the branch path and a 404 on the root path show the SSO line. Fails today. It catches the shared-file defect.
- **Proxied 302.** A 302 answer from `jen api` refuses as "did not answer" and shows `jen`'s own `error:` line. Pins.
- **HTML.** HTML answers with 200 and with 401 refuse as "did not answer". Pins. HTML-200 already has a case near `:3163`.
- **Ledger.** Each path's `jen()` call writes one row to the budget ledger under the test's `PLOT_BUDGET_HOME` (`host.test.mjs:48`), the killed call included, so a timed-out read writes two rows. Pins. It catches a refactor that records a call only on success.
- **`makeJenStub`.** `apiMissing` selects an early branch that answers `unknown command: api`, so the `case` has no dead arm. Today `apiSleep` (`:2706`) has no caller and the `apiMissing` line at `:2757` exits before the `case`. Test refactor, no behaviour change. The existing `apiMissing: true` callers (`:3150`, `:5105`) must keep passing.

Plus these gates:

- A changeset: `'plot': patch`. Description first, `bumps:` block last, and no hand edit of any `metadata.version`. `./scripts/check-changeset-packages.sh` checks it.
- `pnpm build:board` only to test locally. Commit no generated bundle (`scripts/check-no-bundle-diff.sh`).
- Run `node <plot scripts>/board/plot-local-checks.mjs` before each push, with the path resolved from the plot skill's `scripts/` directory, and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.
- `scripts/check-shell-lines.sh pr` — see above.
- `scripts/check-host-cli-callers.sh` — `jen` stays inside `plot-host.sh`.

### Bookkeeping

- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (`jen()` and `jenkins_sha_runs` only), `test/reconcile/host.test.mjs`, one changeset, and whatever shell it removes to pay for its growth.

Other branches of this plan in flight:

- `bug/a-failed-sibling-tag-read-is-cannot-tell` (PR #3626): `release-chain.ts` and its tests.
- `bug/desk-dirt-excuses-the-fleets-own-files`: `plot-desk-dirt.sh`, `reapable.ts`, `sweepable.ts`, `reap.ts`.
- `bug/a-plan-pr-runs-the-estate-tests`: `local-checks.ts`, `ci-job-map.jq`.
- `bug/an-entry-source-selects-its-bundle-tests`: `build.mjs`, `bundles.generated.ts`.

None shares a file with this branch. If you find something the plan did not anticipate, report it rather than improvising outside scope.
