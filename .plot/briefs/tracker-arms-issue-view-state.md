## Implementation brief — tracker-arms-in-plot-host-sh (wave 1: Issue state)

- **Plan (canonical):** docs/plans/2026-10-24-tracker-arms-in-plot-host-sh.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2523 merged
- **Branch:** `feature/tracker-arms-issue-view-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review on the PR, per the repo convention

This is the first of three waves. Wave 2 (`feature/tracker-arms-issue-list-counted`) and wave 3 (`feature/tracker-arms-port-and-advice`) wait on it, and all three edit `skills/plot/scripts/plot-host.sh` or its tests, so they run in sequence by design.

### What to build

`plot-host.sh issue-view` answers `state: open|closed` wrongly on two of three hosts, and the host tests cannot see it. Measured on `origin/main` at `60971d871`:

- **Jira** (`plot-host.sh:5207`) decides `closed` from `.fields.status.statusCategory.name == "Done"`. `name` is localised ("Erledigt" on a German instance), so a closed issue reads open. The stable field is `statusCategory.key` (`done`). A non-null `.fields.resolution` also means closed. The `fields=` request at `:5192` asks for `summary,description,status` only, so `resolution` must be added to it.
- **Bitbucket** (`:5253`) maps `RESOLVED|CLOSED` to closed and everything else to open. `INVALID`, `DUPLICATE` and `WONTFIX` are finished states and read open. `ON HOLD` is not finished and stays open.
- **GitHub** is already right and is only pinned by a test.
- `test/reconcile/host.test.mjs:2119` (GitHub), `:2417` (Bitbucket) and `:5300` (Jira) assert `number`, `title`, `body` and `url` and never `state`, so every wrong mapping above passes every test. Add the `state` assertions first and watch two of them fail before you change the shell.

The plan is canonical; this brief is orientation.

### Settled — do not re-derive

**`statusCategory.key`, not `name`.** `issue-list` already carries the same hazard at `:5042` (`statusCategory: (.fields.status.statusCategory.name // "")`), and its comment at `:5026` says why `statusCategory` is the stable vocabulary. The `:5199` comment claims `issue-view` follows `issue-list`'s word; after this slice the comment must say `key`, not `name`. Do not touch the `:5042` / `:5043` `issue-list` reads — they belong to wave 2's neighbourhood and the plan does not list them.

**Resolution is a second signal, not a replacement.** A Jira issue can sit in a non-Done category with a resolution set, and the reverse. Closed means either `statusCategory.key == "done"` or `resolution != null`. A test needs one case for each signal alone, because a mapping that reads only one passes the other.

**Bitbucket closed set is five words.** `resolved`, `closed`, `invalid`, `duplicate`, `wontfix`. The badge word arrives upper-case with a space in `ON HOLD`; the `sed` at `:5252` already captures `[A-Z ]+`. Compare after the same normalisation the existing `case` uses. An unmapped badge still defaults to open, the default `issue-list` leaves for an unmapped state.

**`PLOT_JIRA_JQL` and `issue-view`.** The plan's Motivation says the Jira arm "ignores `PLOT_JIRA_JQL`" and the slice says `issue-view` "honours `PLOT_JIRA_JQL` the way `issue-list` does". `issue-view` fetches one issue by key from `/rest/api/2/issue/<key>`, which takes no JQL, so the plan does not say what honouring means for a by-key read. Do not guess: if the only workable reading is a second request, say what it costs against the request count that wave 2 is fixing. Report the ambiguity in the PR description and as a plan amendment before you write code for it. The state mapping above does not depend on this and ships regardless.

**Carried over unchanged.** Absent is not false: a Jira response with no `statusCategory` and no `resolution` is `open`, as today. Exit codes stay as the header documents (4 cannot ask, 3 failed lookup). `issue-view` stays read-only; the existing test at `:5343` already asserts no write verb.

### Done when

The plan's slice line is the specification: Jira and Bitbucket `issue-view` map state from the right field, and host tests assert `state` for all three hosts, one case per closed state. The assertions that exist because a naive change would pass without them:

- Jira with `statusCategory: {key: 'done', name: 'Erledigt'}` returns `closed`. Catches a mapping that still reads `name`.
- Jira with a `resolution` object and a `To Do` category returns `closed`; Jira with a `done` category and `resolution: null` returns `closed`. Catches a mapping that reads only one signal.
- Jira with neither returns `open`.
- Bitbucket, one case each for `RESOLVED`, `CLOSED`, `INVALID`, `DUPLICATE`, `WONTFIX` → `closed`, and `ON HOLD`, `NEW`, `OPEN` → `open`. Catches a closed set that is too short or an `ON HOLD` swept in.
- GitHub `state: "CLOSED"` → `closed`, `"OPEN"` → `open`. Pins the arm that was already right.
- Confirm the board reads the `state` field it already carries: `issueOf` in `packages/domain/src/adapters/tracker/tracker-shell.ts` and the board's issue rows. The plan's Board impact note says none expected; the check is part of this slice.

Plus: this slice changes a `.sh` file. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, stores no number and has no override. Pay for growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. Add a changeset (`'plot': patch`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. `test/reconcile/host.test.mjs` can stall under load: run the test names you touched, not the whole file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Issue state` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the `issue-view` arms of `skills/plot/scripts/plot-host.sh` (Jira at about `:5185-5210`, Bitbucket at about `:5249-5255`) and the `issue-view` tests in `test/reconcile/host.test.mjs`.

It does not own `issue-list` (wave 2), the tracker port, `tracker-shell.ts`, `issue-source.ts`, `plot-detect-repo.sh` or `skills/plot-board-setup/SKILL.md` (wave 3). Other plans in flight touch `plot-host.sh` as well — `jenkins-sha-lookups-in-plot-host` (branch `bug/jenkins-sha-runs-bind-by-action`) and `bitbucket-pr-rows-run-per-row` edit its Jenkins and Bitbucket PR arms, not `issue-view`. Expect line numbers to move; anchor on the `issue-view` op, not the numbers here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
