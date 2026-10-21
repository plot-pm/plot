## Implementation brief — jira-issue-list-answers-an-unknown (wave 1: Unknown version and cut notice)

- **Plan (canonical):** `docs/plans/2026-10-21-jira-issue-list-answers-an-unknown.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2257 merged
- **Branch:** `bug/jira-issue-list-answers-an-unknown` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Single slice. Nothing waits on it and it waits on nothing.

### What to build

Two silent answers from the Jira arm of `issue-list)` in `skills/plot/scripts/plot-host.sh`. `issue-list --state version --fix-version <name>` for a version Jira does not have builds `fixVersion = "<name>"` (near line 4936) and exits 0 with no rows. An unpaged open read with no `--limit` reads `max="${limit:-50}"` (near line 4904), prints 50 rows and does not say that more exist (measured 2026-10-21, ewz-kus-portal: more than 100 open EWZKUS issues, 50 printed, no note). The fix refuses an unknown version with `version-not-found: <name>` and a non-zero exit, and prints one stderr line when an unpaged open or inbox read is cut. Stdout does not change. Update the `issue-list` header comment (near lines 295 and 407) for both. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The existence check reads `version-list`, not a new endpoint.** The `version-list <project>` op (near line 5288) already returns every version of one project unfiltered and "decides nothing". The sprint gate's `versionRead` in `packages/domain/src/adapters/tracker/tracker-jira.ts:189` asks it once per `Ticket prefixes` project and treats zero same-named copies as `version-not-found`. The shell check does the same over the same projects (`tracker_projects`), so both paths name one reason and agree on a same-named version in another project: it does not count. Do not call `/rest/api/2/version` or search by JQL; an unknown `fixVersion` in JQL is exactly the silent empty answer.

**The adapter is not a caller to change.** `versionRead` checks the version first and then calls `issueListVersion`, which runs `issue-list --state version`. After this change that path asks `version-list` twice per project (once in the adapter, once in the shell). That is the plan's open question 1. Measure it with the curl stub (count calls for one `versionRead`) and state the number in the PR. Do not remove the adapter's check to save the call: it needs the version objects for `versionOf`, and `tracker-shell.ts` and `tracker-jira.ts` are outside this slice. If the double call is a problem, report it as a follow-up.

**Refuse before the issue search, and exit 3 or 4 like its neighbours.** The refusal runs before the `search/jql` curl, so a refused call spends one call per project and no search. Use a code this arm already owns and say which in the header comment: `exit 4` is "this host cannot answer this" (see the `Ticket prefixes` guard at line ~4891); `exit 3` is "the tracker moved / a request failed". An unknown version is neither a failed request nor a missing config, so choose one, name it in the header, and test it. Do not add a new exit code.

**A failed version-list is not "unknown".** If `jira_ask` fails (auth, 5xx, 404 on a project), propagate its exit code (`|| exit $?`). Only a successful read with no same-named copy is `version-not-found`. Absent is not false: an unreadable answer must never read as an unknown version.

**The cut notice is stderr, one line, in `pr-list`'s form.** `pr_list_report_truncation` (line ~2985) prints `plot-host: <be> pr-list state=<s> possibly truncated (<n> rows, requested limit <L> unprovable) — …`. Print the Jira form `plot-host: jira issue-list state=<s> possibly truncated (<n> rows, requested limit <L>)`. Do not reuse the function: it takes a `pr-list` backend word and its wording is pinned by `plot-fleet-scan.sh` on both sides (the "sweep complete" contract). A copied line that matches that pin would license a claim it never proved.

**Fire the notice only on an unpaged read (open, inbox).** A `--paged` read, and every closed, changed and version read, already prints its `{"nextPageToken":…}` line, which is the signal. A notice there duplicates it (plan open question 2). The cut test is the response's own `nextPageToken` (the `search/jql` response carries it when more rows exist), read from `$body` before the `jq` projection; fall back to `rows == max` only where the field is absent. A page that returned fewer than `max` rows with a token is still cut. Do not count lines of stdout.

**Stdout is the contract.** Readers of the open read take every stdout line as an issue (`issue-list` header). A notice on stdout, or a token line on an unpaged read, breaks `tracker-shell.ts` and `plot-reconcile-scan.sh`. The scan treats a non-empty stderr as noise, but check `plot-reconcile-scan.sh` near line 3093 for any `2>&1` before relying on that.

**Rules carried over:** `plot-host.sh` stays the one place that talks to the host CLI (`scripts/check-host-cli-callers.sh`). The sibling `jira-issue-list-limit-above-one` (#2213, Delivered) refuses an unpaged `--limit` above one page with exit 2; keep that guard and its tests unchanged. A new test helper is an arrow function, and a test's `run()` clears `PLOT_UNATTENDED`.

### Done when

The plan has no `## Done when` list; the slice line is the specification: refuse an unknown `--fix-version` with `version-not-found`, report a cut `issue-list` result on stderr, contract tests in `test/reconcile/host.test.mjs`, the header comment updated, the plan's two open questions answered in the PR body. These assertions exist because a naive implementation passes without them:

- **A known version still answers.** Catches a check that refuses every name (for example a project-key mismatch or a `released` filter).
- **An unknown version exits non-zero, names `version-not-found: <name>` on stderr, and the stub sees no `search/jql` call.** Catches a check placed after `jira_ask`.
- **A same-named version only in a project outside `Ticket prefixes` is unknown.** Catches a check that reads every project.
- **A failing `version-list` (stub returns 500) exits with that failure's code, not the not-found one.** Catches "empty means unknown".
- **A version name with `"` or `\` still reaches the check unescaped for comparison and escaped only in the JQL.** Catches a double-escape.
- **A default open read of exactly 50 rows with a `nextPageToken` prints the notice; 50 rows with no token prints none; 49 rows prints none.** Catches a count-only test.
- **A `--paged` read and a version read print no notice.** Catches a notice that duplicates the token line.
- **Stdout of a cut read is byte-identical to before.** Catches a notice on the wrong stream.

Plus: add a changeset (`'plot': patch`, description first, `bumps:` block last; `plot-host.sh` belongs to the `plot` skill, so name that skill in `bumps:` per `scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: this change adds shell, so remove shell elsewhere in the same change, or keep the version check short and write the notice as one `printf`. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Jira arm and the header comment of `issue-list` in `skills/plot/scripts/plot-host.sh`, `test/reconcile/host.test.mjs`, one changeset, and the plan's answered open questions. It does not touch the GitHub or Bitbucket arms, `tracker-jira.ts`, `tracker-shell.ts`, the `--limit` above-one guard, `pr_list_report_truncation`, or `board-server.mjs` (generated; never commit a rebuild).

Other branches in flight on `plot-host.sh` issue ops: none named by an approved plan at dispatch (no remote branch matches `jira-issue-list-answers`; last three commits to the file are #2240, #2235, #2241, none on `issue-list`). Run `git log origin/main -5 -- skills/plot/scripts/plot-host.sh` before the first edit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
