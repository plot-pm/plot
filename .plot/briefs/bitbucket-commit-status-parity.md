## Implementation brief — bitbucket-parity-and-app-identities (wave 1: `feature/bitbucket-commit-status-parity`)

- **Plan (canonical):** `docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md` on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Branch:** `feature/bitbucket-commit-status-parity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan's `Review: pr`)

This branch is one of five in Wave 1, all eligible together. It fixes #1713 only. The other four (`bug/merge-names-what-it-did`, `bug/bitbucket-pages-read-complete`, `bug/writer-app-push-uses-only-the-app`, `bug/app-identities-refuse-by-name`) touch other files, except that `bug/bitbucket-pages-read-complete` and `bug/app-identities-refuse-by-name` also edit `plot-host.sh`, in other functions.

### What to build

`plot-host.sh commit-status` on Bitbucket (the arm at `plot-host.sh:5314`, which shells to `skills/plot/scripts/plot-bitbucket-commit-status.mjs`) trails the GitHub arm in six ways, all named in the plan's Motivation table for #1713:

1. `STATE_MAP` (`plot-bitbucket-commit-status.mjs:44`) holds `success` and `failure` only. A caller passing `pending` exits 4 as `unsupported`. Map `pending` to `INPROGRESS`: the plan's Changelog commits to it.
2. `error` has no Bitbucket state (`FAILED` and `STOPPED` are the nearest). The plan leaves the choice to this slice: pick one mapping or keep the named refusal, and record which in the plan's Open Questions and in the helper's header comment. Do not leave it undecided.
3. The `fetch` call has no timeout. A hung API holds the caller. Add an `AbortSignal.timeout(...)` and exit 3, naming the timeout, when it fires.
4. `workspace`, `repoSlug` and `sha` enter the URL unencoded. Wrap each in `encodeURIComponent`.
5. The `_bb_wr` slug parse in `plot-host.sh` (the `sed` pipeline in the `commit-status` arm) fails on a trailing slash in the origin URL. Either tolerate it or answer `unsupported`; say which in a test.
6. The `plot-host.sh` row in `skills/plot/scripts/README.md` still says `commit-status` is "(GitHub only)". Correct it to say both backends, and name the Bitbucket credential pair (`BITBUCKET_REVIEW_USER`, `BITBUCKET_REVIEW_APP_PASSWORD`).

Add a corpus test holding both backends' answers for the same inputs (see Done when).

### Decisions the plan settles — do not re-derive them

**The Bitbucket arm is a direct API write under a dedicated account, never `bb`.** `test/reconcile/host-commit-status.test.mjs` asserts that no `bb` child process runs and that the credential never reaches stdout, stderr or argv. Keep both: a timeout or an encoding fix must not move the write onto `bb`.

**The credential is read from the environment, then `.env`, and only as a pair.** Half a Basic credential authenticates nothing (`loadEnvFile`). The refusal for a missing pair stays exit 4 and names both variables.

**Exit codes are the contract.** 1 for a missing argument, 3 for a write that reaches the API and fails (now including a timeout), 4 for `unsupported` or a missing credential. Callers read the code, not the message; do not renumber.

**Absent is not false.** An unresolvable slug is `unsupported` (exit 4), never a 404 from a malformed URL. The existing test `an unresolvable workspace/repo exits naming unsupported` holds this; the trailing-slash fix must not weaken it.

**Open question the slice must close: Bitbucket's merge-check shape.** #1711's plan left it open. Answer it in the plan, or record it there as out of scope with the reason. Do not build it silently into this slice.

### Done when

The plan's slice line is the specification: `pending` mapped and `error` decided, a fetch timeout, encoded URL parts, the `_bb_wr` parse tolerant of a trailing slash or answering `unsupported`, the README row corrected, and a corpus test holding both backends' answers. Lift these assertions, because a naive patch passes without them:

- A `pending` write posts `state: "INPROGRESS"` to a fake Bitbucket and exits 0. The existing test that expects `pending` to exit 4 must change in the same commit; a green suite with that test untouched means the mapping was not added.
- The `error` decision has a test of its own, whichever way it goes.
- A fake API that never answers makes the helper exit 3 inside the timeout. Without this test, a timeout constant that is never passed to `fetch` passes.
- A workspace or sha containing `/` or `?` reaches the fake API as an encoded path segment. Assert the recorded request path, not the helper's return.
- An origin of `git@bitbucket.org:myws/myrepo/` resolves to `myws/myrepo`, or exits 4 `unsupported`, per the choice you record.
- The corpus test feeds one input set to the GitHub and Bitbucket arms and compares the states each accepts and refuses. Where the answers disagree it names both answers and the input. On a disagreement the branch stops; adjusting either side to make the comparison pass is the one forbidden move (`docs/shell-and-domain.md`). Place it with the other corpus tests (`packages/domain/corpus/`) if the rule lives in the domain; if both arms are Node helpers outside the domain, put it beside `test/reconcile/host-commit-status.test.mjs` and say why.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so a longer slug parse is paid for in the same change: remove shell elsewhere, or write the rule in the helper and ask it through the bundle. The gate stores no number and has no override. Add a changeset (description first, `bumps:` block last; package `plot`, skill `plot` patch is the usual level for a fix like this, and `plot:` line naming this plan).

### Bookkeeping

Open the PR through the controller once a first real commit exists: `skills/plot/scripts/plot-open-pr.sh` (or `--draft` while it moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-bitbucket-commit-status.mjs`, the `commit-status` arm of `skills/plot/scripts/plot-host.sh`, the `plot-host.sh` row of `skills/plot/scripts/README.md`, `test/reconcile/host-commit-status.test.mjs`, the new corpus test, and the changeset.

Other Wave 1 branches: `bug/bitbucket-pages-read-complete` edits `plot-host.sh` (`bb_state_listing`, `pr_list_report_truncation`) and may edit the same README row; `bug/app-identities-refuse-by-name` edits `plot-host.sh`'s repo-lookup failure path and `plot-commit-status.mjs`, which is the GitHub half of this op. Touch neither. Same-file edits in different functions are a known collision that `/plot-merge-queue` predicts; do not pre-resolve them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
