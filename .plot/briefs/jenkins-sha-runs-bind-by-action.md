## Implementation brief — jenkins-sha-lookups-in-plot-host (wave 1: Sha binding)

- **Plan (canonical):** docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2497 merged
- **Branch:** `bug/jenkins-sha-runs-bind-by-action` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention; open the PR through `plot-open-pr.sh`

This is wave 1 of 3. Wave 2 (`bug/jenkins-refusals-and-credential-fallback`) and wave 3 (`bug/jenkins-sha-tests-run-in-a-private-home`) wait on it, because all three edit `plot-host.sh` or `test/reconcile/host.test.mjs`.

### What to build

`jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1838`) builds two flat lists per build, `shas` (every `lastBuiltRevision.SHA1`) and `br` (every branch name), and joins them with `[.br, .shas] | transpose` inside `headsha`. A revision with zero or several branches shifts every later pair, so the asked branch can bind the merge-base sha, and the plan an implementer reads then tells them to reuse that sha (#2231, #2244, #2180). The same function applies the `tree` query's `{0,$limit}` on Jenkins' side and drops `NOT_BUILT` and `ABORTED` afterwards in jq, so `runs --limit N` returns fewer than N rows, or none (#2166, #2199). On a plain job the match keys on `$job | split("/") | last` and not on the asked branch (#2244, #2309).

Replace the two lists with one record per `lastBuiltRevision` action: `{sha, branches}` read from the same action. A build with several actions is searched record by record. A record with no branch name never matches a named branch. `transpose`, `br` and `shas` go away. On a plain job the match keys on the asked branch, and the last path segment stops being a key. Filter `NOT_BUILT` and `ABORTED` before the limit applies. Rewrite the doc comment above `jenkins_sha_runs` as current behaviour: the filter, the match rule, no history. Issue #2478 lists the findings; the plan is canonical, this is orientation.

### Decisions the plan settles — do not re-derive them

- **Position is not a pairing.** Joining two flat lists by index cannot be repaired by a better default, because the lists lose which action a name came from. The pair must be read from one action. Do not keep `transpose` with a length guard.
- **The plain-job key is the asked branch.** The job's last path segment names a job, not a branch. Existing tests at `test/reconcile/host.test.mjs:4189` and `:4224` assert today's plain-job behaviour. Read them first; where one pins the last-segment key, the test is wrong and changes with the code. Where one pins that a build is matched once despite two entries naming the branch, that behaviour stays.
- **Rules carried over unchanged.** `ABORTED` still shows on `runs-for-sha` for the exact sha asked (tests at `:3649`, `:3673`) and is dropped only on the unfiltered `runs` arm. `NOT_BUILT` never shows. A short sha of 7 or more hex characters prefix-matches. Absent is not false: a build with no revision record answers no sha, never the merge-base sha.
- **Gate arithmetic.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. It stores no number and has no override. Removing `transpose`, `br` and `shas` should pay for the per-action record; if it does not, remove shell elsewhere in `plot-host.sh`.

### Open questions the slice closes

The plan leaves two for this wave. Decide each, record the answer in the plan's Design section, and say it in the PR body.

1. Can the `tree` query filter `result` server-side, or must `runs` over-fetch? Probe the query against a Jenkins `api/json` shape in the test fixtures before choosing. If you over-fetch, name the factor and why it bounds the cost against the Jenkins rate budget (`host_slot_take`, `budget_record_call`).
2. A build whose actions hold several `lastBuiltRevision` records for the asked branch (a merge build): does the first, the last or any record bind the build's sha? The fix for #2322 assumed the entries agree. Pick one, and add a test where they disagree.

### Done when

The plan's slice line is the specification: branch and sha read from the same `lastBuiltRevision` action; plain-job match keyed on the asked branch; `NOT_BUILT` and `ABORTED` filtered before the limit; doc comments rewritten. Plus these assertions, which a naive implementation passes without:

- A build whose first revision names no branch and whose second names the asked branch binds the second record's sha. Catches a fix that only reorders the flat lists.
- A build with a merge-base record and a head record for the same branch does not bind the merge-base sha to the asked branch. Catches positional pairing surviving in a different form.
- `runs --limit 3` over five builds where two are `NOT_BUILT` returns 3 rows, not 1. Catches the limit still applying before the filter.
- A plain-job `runs-for-sha` for a branch that is not the job's last path segment matches. Catches the last-segment key surviving.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `host.test.mjs` cannot complete under load: run the test names you touched, not the whole file. `scripts/check-shell-lines.sh` applies as above. Add a changeset for `plot` (patch) with the description first and the `bumps:` block last. Do not commit the board bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `jenkins_sha_runs` and its doc comment in `skills/plot/scripts/plot-host.sh`, the Jenkins sha tests in `test/reconcile/host.test.mjs`, and one changeset. It does not touch `jenkins_resolve_host`, the credential loaders, the Jira hint, or the test-hygiene retitles; those belong to waves 2 and 3. Related merged plans on the same code (`2026-10-21-jenkins-run-for-sha-can-answer.md`, `2026-10-21-jenkins-run-for-sha-on-the.md`, `2026-10-22-jenkins-runs-lists-every-build-twice.md`, `2026-10-19-jenkins-checks-never-bind-to-the.md`) set the behaviour you keep.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
