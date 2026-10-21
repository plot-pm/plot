## Implementation brief — jira-issue-list-limit-above-one (wave 1: Limit guard)

- **Plan (canonical):** `docs/plans/2026-10-21-jira-issue-list-limit-above-one.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2222 merged
- **Branch:** `bug/jira-issue-list-limit-above-one` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Single slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh issue-list --limit 200` on a Jira tracker prints 100 rows and exits 0 (measured 2026-10-21, ewz-kus-portal, read-only). The open read sends `maxResults=$limit`, Jira caps it at 100, and the unpaged read drops the `nextPageToken`. The caller cannot tell that 100 more rows exist. The fix makes the Jira open read refuse (exit 2, usage error naming `--paged`) when `--limit N` has `N > ISSUE_PAGE_ROWS` and `--paged` is absent. The code is the `max="${limit:-50}"` line in the Jira arm of `issue-list)` (`skills/plot/scripts/plot-host.sh`, near line 4871) and the header comment of `issue-list` (near line 290). The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Refuse, do not warn and clamp.** A stderr warning is lost wherever stderr is discarded, and the `issue-list` three-outcomes rule says a partial answer must not look like a complete one. Exit 2 is the plan's choice. The ops here otherwise use `die` (exit 1) for usage errors and 3/4/5/6 for host states, so exit 2 is a new code in this arm: say so in the header comment's exit-code text.

**Only the Jira arm changes.** The GitHub arm is out of scope unless you measure the same truncation there. `gh issue list --limit N` pages by 100 inside one process and the arm records the extra calls (`budget_record_call` loop), so it is expected to be correct. Measure with a stub, do not guess; if it truncates, report it rather than widening the slice.

**A closed, changed or `--paged` read is already clamped to one page** (`[ -z "$paged" ] || { max=...; }`) and prints its token. The guard applies to the open and inbox reads that are unpaged. Do not change what a paged read prints.

### The plan's open question 3 has an answer, and it contradicts the plan's Board-impact comment

The plan says no internal caller asks an unpaged limit above 100. That is wrong for one caller:

- `skills/plot/scripts/plot-reconcile-scan.sh:2999` sets `ISSUE_LIMIT=${PLOT_ISSUE_LIMIT:-200}` and line 3093 runs `plot-host.sh issue-list --limit "$ISSUE_LIMIT"` with no `--paged`.
- On Jira today that read returns 100 rows. The scan's own "full window" note fires only at `oi_count >= ISSUE_LIMIT` (line 3141), so 100 rows against 200 prints no warning. The scan inherits the silent truncation.
- After a refusal, that call exits 2. The scan's `elif [ "$oi_rc" -ne 0 ]` arm prints `(not evaluated — the tracker question failed: …)`. That is honest, but it turns `/plot-reconcile` into "not evaluated" for every Jira repo at default settings.

The slice must therefore keep the scan answering on Jira. Pick one and say which in the PR: (a) the scan passes `--paged` and treats a trailing `{"nextPageToken":…}` line as "window full" (the existing `select(.number != null)` filter already ignores that line); or (b) the scan clamps its own limit. Option (a) is the honest one: it reports the truncation instead of choosing a smaller number. `scripts/check-shell-lines.sh` ratchets shell growth against the merge base and has no override: pay for any added scan lines by removing shell elsewhere in the same change, or keep the scan edit to a net-zero line count. The `tracker-shell.ts` adapter is not a caller: `issueList(limit)` is passed through three adapters and no production code calls it with a limit, and its `walk` passes `--paged` in `head`. Verify that with `grep -rn "issueList(" packages/*/src` before relying on it.

Also correct the plan's Board-impact comment in the same PR, since it states a fact the grep disproves.

### Rules carried over

- **Absent is not false; read the exit code, not the emptiness.** The refusal must happen before any `curl`, so a refused call spends nothing: assert that the curl stub is never invoked.
- **`plot-host.sh` stays the one place that talks to the host CLI** (`scripts/check-host-cli-callers.sh`).
- **A new test helper is an arrow function**, and a test's `run()` must clear `PLOT_UNATTENDED`.

### Done when

The plan has no `## Done when` list; the slice line is the specification: refuse on Jira `--limit` above one page without `--paged`, a contract test in `test/reconcile/host.test.mjs`, the header comment updated. These assertions exist because a naive implementation passes without them:

- **`--limit 100` still answers.** A guard written `-ge` instead of `-gt` refuses a full page. Test `100` succeeds and `101` refuses.
- **`--limit 200 --paged` answers with one page of 100 and the token line.** Catches a guard that refuses `--paged` too, which is the only way a direct caller reads more than one page.
- **No `--limit` still answers.** The default is 50; a guard comparing an empty string errors under `set -u`.
- **A refused call never runs `curl`.** Catches a guard placed after `jira_ask`.
- **The scan on Jira answers instead of printing "not evaluated".** Use the existing Jira curl stub in `test/reconcile/scan.test.mjs` or `host.test.mjs`; it catches a fix that makes the host honest and breaks the one internal caller.
- **A non-numeric `--limit` is not turned into a guard bypass.** `[ "$limit" -gt 100 ]` on `abc` errors; decide and test the result.

Plus: add a changeset (`'plot': patch`, description first, `bumps:` block last, `plot-host` is not a skill so name the skill that owns it per `scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Name `scripts/check-shell-lines.sh`: it refuses a pull request whose shell under `skills/` is longer than at its merge base, so growth is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Jira arm and header comment of `issue-list` in `skills/plot/scripts/plot-host.sh`, the one `ISSUE_LIMIT` call in `skills/plot/scripts/plot-reconcile-scan.sh`, `test/reconcile/host.test.mjs`, a scan test, the plan's Board-impact comment and one changeset. It does not touch the GitHub arm, the Bitbucket arm, `tracker-shell.ts`, the exit-code meaning of 3/4/5/6, or `board-server.mjs` (generated; never commit a rebuild).

Other branches in flight on `plot-host.sh` issue ops: none named by an approved plan at dispatch; the sprint's sibling plans (`bitbucket-with-tracker-plot-the-message`, `jira-issue-list-limit-above-one`'s neighbours) touch other ops. Run `git log origin/main -5 -- skills/plot/scripts/plot-host.sh` before the first edit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
