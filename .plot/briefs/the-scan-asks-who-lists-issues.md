## Implementation brief — the-issue-ops-ask-who-answers (wave 2: The scan asks who lists issues)

- **Plan (canonical):** `docs/plans/2026-10-01-the-issue-ops-ask-who-answers.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-scan-asks-who-lists-issues` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority

Wave 2 of 2. It waits on `bug/the-host-script-asks-who-lists-issues`, which merged (`48599fcfc`, `plot-host: issue-list and issue-view ask who lists the issues`): `skills/plot/scripts/board/plot-issue-source.mjs` and `plot-host.sh`'s `issue_source` helper exist on `main`. Cut from `origin/main` and confirm both before you start.

### What to build

`plot-reconcile-scan.sh` section 23 (`open_issues=`) reads the `Tracker` scheme itself (`oi_scheme`, an `awk '{print tolower($1)}'` over `cfg "Tracker"`), refuses `jira`, and sends every other scheme to `plot-host.sh issue-list`. The scan therefore holds the same drifted second copy of the rule that `plot-host.sh` held until wave 1. The observed failure: a repository with `Tracker: linear` has its finished plans' `Issue: #N` compared against the git host's open issues, which is a list from the wrong service.

Make the section ask the entry before any host call:

1. **Take two readings.** The `Tracker` value verbatim (`cfg "Tracker" ""`, not the `awk` first-token form — the entry takes the whole value on stdin because it can carry a URL) and the backend word from `bash "$script_dir/plot-host.sh" backend`.
2. **Ask.** `printf '%s' "$value" | node "$script_dir/board/plot-issue-source.mjs" "$backend"`. Read the exit code first: non-zero, or a first word outside `tracker` / `git-host` / `nobody`, means the entry could not be asked.
3. **Branch on the answer**, in this order inside the existing `if` chain, after the `oi_plans -eq 0` and `PR_SOURCE = off` arms (those two stay first: an estate with nothing to check, or an offline run, asks nothing):
   - `nobody` → print `  (not evaluated — <reason>)` with the rule's sentence, then the note `  note: $oi_plans finished plan(s) naming an issue went unchecked.` Make no host call.
   - `tracker` with scheme `jira` → the existing refusal at the current `elif [ "$oi_scheme" = "jira" ]` arm, wording unchanged.
   - `tracker` with `github-issues`, or `git-host` → the existing `issue-list` call and everything after it, unchanged.
   - Entry cannot be asked → `  (not evaluated — the tracker source could not be decided: <reason>)` and the same note. Never `(none)`, and never a fall-through to the host call.
4. Replace `oi_scheme` with the entry's scheme word; do not keep both readings. Update the section's header comment where it says the key is read "the way section 21 reads `Worktree root`" and that `plot-host.sh` exposes no scheme op — both are now false.

### Settled decisions — do not re-derive them

**The backend comes from `plot-host.sh backend`, not from the scan's origin URL.** `issue-list` resolves its backend from the `Git host` key, and the entry's `onlyOnHost` rule (`github-issues` only on GitHub) must judge the host the call would reach. The origin-URL `case` at `plot-reconcile-scan.sh:459-462` answers a different question — which remote's PRs the scan compares — and its own comment says so. Passing `PR_SOURCE` or `host_env` would let the entry say `tracker github-issues` while the call goes to Bitbucket.

**The scan asks the entry although `issue-list` now refuses by itself.** After wave 1, `plot-host.sh issue-list` with `Tracker: linear` already exits 4 without calling `gh`, and the section already prints `(not evaluated — this host cannot be asked for issues: …)`. Wave 2 still earns its place: the section makes no `issue-list` process call for such a scheme, and it prints the rule's own sentence, not the adapter's wrapper. Do not conclude the slice is redundant and stop; the plan's `Done when` names an assertion that fails today (the host stub records an `issue-list` call). Run it first and see it fail.

**The entry exits 0 on `nobody`.** The rule answered. Report it as *not evaluated*, which is the only honest reading: `(none)` would report a clean estate the section never measured (`an-outage-is-not-an-answer`). Exit 2 from the entry means the backend argument was empty; treat it, like any non-zero, as *could not be asked*.

**Empty `Tracker` still asks the git host.** The entry answers `git-host` for empty stdin. A repository with no `Tracker` key must see no change; the existing tests at `test/reconcile/scan.test.mjs:4081-4195` pass unchanged and are the regression lock. Read the exit code, not stdout's emptiness.

**The note counts plans.** Every `(not evaluated — …)` arm prints the `$oi_plans finished plan(s)` note: "some plans" cannot be acted on, "21 plans" can.

**`open_issues=` stays 0 on every unevaluated arm and the section stays out of `attention=`.** It reports and never gates; do not touch the footer.

**No new script, no second copy of the rule.** The scan already runs bundles beside it (`plot-pr-index-lookup.mjs` at `:666`, `plot-reconcile.mjs` at `:2558`), so one more node hop per scan is the established shape; the scan runs once per operator command, never once per agent per pass. Do not list tracker schemes in shell. The rule, the entry and `plot-host.sh` do not change — if one needs to, report it.

### Done when

The plan's `## Done when` Slice 2 line is the specification: a scan fixture with `Tracker: linear` and one delivered plan naming `Issue: #7` prints `(not evaluated — no connector lists issues from the declared tracker \`linear\` …)` in section 23, reports `open_issues=0`, and its host stub records **no `issue-list` call**. It fails on `origin/main` today.

The assertions that exist because a naive implementation passes without them:

- **The no-call assertion.** Make the `plot-host.sh` stub append every argument line to a marker file and assert the file holds no `issue-list` line. A fix that prints the right sentence after calling `issue-list` passes every output assertion. The existing `--no-pr` test uses the same marker idea.
- **The stub must answer `backend`.** `issueFixture` stubs the whole `plot-host.sh`; a stub without a `backend` arm makes the new call fail and the section print the could-not-be-asked arm for every test, including the regression locks. Add the arm to the stubs you write and check the existing stubs still pass (`case … *) echo "{}"` echoes `{}` as the backend today).
- **Could-not-be-asked prints `not evaluated`, never `(none)`, and calls no host.** Make the bundle unreadable in the fixture's shim (it copies `board/*.mjs`; delete `plot-issue-source.mjs` there) and assert the sentence, `open_issues=0`, and no `issue-list` call.
- **`tracker jira` keeps its refusal wording** (`plan Issue: numbers cannot be matched to Jira keys`), asserted with `Tracker: jira https://example.atlassian.net`. This catches an implementation that reads only the first token before the entry and loses the URL case.
- **Regression locks:** empty `Tracker` and `Tracker: github-issues` on a GitHub fixture still call `issue-list`; the exit-4 and exit-3 tests at `:4147` and `:4173` pass unchanged.

Plus: contract tests in `test/reconcile/scan.test.mjs`, added as a new block after the section 23 tests; a `plot` patch changeset (copy the format from `git log -- .changeset`: the description first, the `bumps:` block last; no `@plot-pm/board` changeset, since no board source changes). No `pnpm build:board` is needed unless `packages/board` changes. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run under Node 24 (`nvm use`). Re-run a failing file alone before believing a failure.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`; never `gh pr create`. When it exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section, as `(Branch: bug/the-scan-asks-who-lists-issues, PR: #N)`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-reconcile-scan.sh` (section 23 only), `test/reconcile/scan.test.mjs`, and one changeset. It does not touch `plot-host.sh`, the entry, `packages/`, or any generated `board/*.mjs`.

Other branches on `origin` that touch `plot-reconcile-scan.sh` or `scan.test.mjs`: none (checked 2026-10-02 with `git diff origin/main...<branch> --name-only` over every remote branch). Re-check with `git diff origin/main...origin/<branch> --name-only` on any branch the fleet lists before you push. A merge conflict in `board-server.mjs` is not yours: take either side, run `pnpm build:board`, commit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
