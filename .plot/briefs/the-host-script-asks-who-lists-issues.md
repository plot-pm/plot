## Implementation brief — the-issue-ops-ask-who-answers (wave 1: The host script asks who lists issues)

- **Plan (canonical):** `docs/plans/2026-10-01-the-issue-ops-ask-who-answers.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-host-script-asks-who-lists-issues` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority

Wave 1 of 2. `bug/the-scan-asks-who-lists-issues` (wave 2) waits on this branch merging, because it calls the entry this branch builds.

### What to build

`plot-host.sh issue-list` and `issue-view` send every `Tracker` scheme except `jira` to the git host. The observed failure: `PLOT_HOST=github PLOT_TRACKER=linear plot-host.sh issue-list --limit 5` exits 0 and a recording `gh` stub sees `gh issue list --state open --limit 5 --json number,title,url,createdAt`. `PLOT_TRACKER=plot` gives the same, and `issue-view 7` calls `gh issue view 7` for both. A repository tracking in Linear is shown its git host's issues under Linear's name.

The rule that decides this exists: `issueSource` (`packages/domain/src/rules/issue-source.ts`, #1132) has eight unit tests, and the board asks it before the host call (`packages/board/src/server/fleet.ts:2369-2380`). Build the shell's way to ask it, and make `issue-list` and `issue-view` ask:

1. **Move `TRACKER_LISTERS`.** The constant lives in `packages/domain/src/adapters/tracker/tracker-resolve.ts`, which imports `runProcess` and three connectors. Move it to a new `packages/domain/src/adapters/tracker/tracker-listers.ts` that imports only the `IssueLister` type, and re-export it from `tracker-resolve.ts` so `fleet.ts:75` and every other importer stay unchanged.
2. **Build the entry.** `packages/board/src/server/entry/issue-source.ts` — the plan writes `entry/issue-source.ts` without the package, but the entries live under `packages/board/src/server/entry/`, beside `desk-root.ts`. Copy `desk-root.ts`'s shape: the narrow imports (`@plot-pm/domain/rules/issue-source`, `@plot-pm/domain/adapters/tracker/tracker-listers`; the package's `./adapters/*` export pattern resolves the nested path), an exported `EXIT` table, a TSDoc block that states the exit codes, and the `pathToFileURL` main-guard. The usage is `plot-issue-source.mjs <git-host>` with the `Tracker` value on **stdin**, because the value can carry a URL after the scheme. One line out, exit 0: `tracker\t<scheme>`, `git-host`, or `nobody\t<reason>`. Exit 2 when the git host argument is missing.
3. **Build target.** Add it to `packages/board/build.mjs` beside the `plot-desk-root.mjs` block (`:985-1020`), shipped to `skills/plot/scripts/board/plot-issue-source.mjs`, and print its size the way the neighbours do. Run `pnpm build:board`.
4. **`issue_source` helper in `plot-host.sh`.** `node "$here/board/plot-issue-source.mjs" "$(backend)"` with `tracker_raw` on stdin (`tracker_raw` is at `:2272`, `backend` at `:2714`, `here` at `:395`). `issue-list` (`:4306`) and `issue-view` (`:4494`) call it **once, before their arms**, after their argument parsing:
   - `nobody` → the reason on stderr with the `plot-host:` prefix, exit 4.
   - `tracker` with `jira` → the existing Jira arm. `tracker` with `github-issues`, or `git-host` → the existing git-host arm.
   - The entry cannot be asked (node missing, bundle missing, non-zero exit, an answer outside the three words) → a sentence on stderr that names the entry, exit 1.

### Settled decisions — do not re-derive them

**An unaskable entry exits 1 and never falls through to the git host.** The fall-through IS the defect. Exit 1 is what every caller already reads as *the question failed*; exit 4 means *this host cannot be asked at all*, and collapsing the two reproduces `an-outage-is-not-an-answer` — a list that says *none* because it could not ask. Do not add a fallback to the old `tracker_scheme` test for a missing bundle.

**`issue-status` is not touched.** Its own `jira` test at `:4619` stays. It writes, and only the Jira connector writes a status; that is a different question from who lists issues, and the plan names it as out of scope.

**No new `plot-*.sh` script, and no second copy of the rule.** `plot-host.sh` holds no `.mjs` call today and its `jira`-only test is a drifted second copy of the rule. Replace the test; do not add a lister list in shell. The cost rule permits one node hop: the script runs once per operator command or once per board PR refresh (`fleet.ts:3101-3114`), never once per agent per pass, and a shipped bundle answers in 39 ms (`docs/shell-and-domain.md:17`).

**The rule does not change.** `issueSource`, `issueAbsence` and their eight tests stay as they are. If the entry needs something the rule does not give, report it.

**Absent is not false.** An empty `Tracker` still asks the git host — the entry answers `git-host` for empty stdin, and empty stdin is a complete answer, not a failure. Read the exit code, not stdout's emptiness.

**A repository that declared `Tracker: plot` on GitHub loses its open-issue list in `plot-host.sh`**, as it already did on the board with #1132. This is the rule's decision, stated in the plan's Open Points so a reviewer can object. Do not restore it here.

### Done when

The plan's `## Done when` Slice 1 list is the specification. Each assertion fails on origin/main today:

- `issue-list` with `PLOT_TRACKER=linear` and with `plot` on `PLOT_HOST=github` exits 4, stderr names the scheme, and a recording `gh` stub records **no call**. The no-call assertion is the one a naive fix fails: a fix that prints the reason and exits 4 *after* calling `gh` passes an exit-code test.
- `PLOT_HOST=bitbucket PLOT_TRACKER=github-issues` with a recording `bb` stub exits 4 and stderr names `github`. This catches an entry that reads only the scheme and ignores `onlyOnHost`.
- `issue-view 7` with `PLOT_TRACKER=linear` exits 4 with no `gh` call.
- With the bundle path made unreadable, `issue-list` exits 1, names the entry, and records no `gh` call. This catches the fall-through.
- Regression locks: an empty `PLOT_TRACKER` still calls `gh issue list`; `PLOT_TRACKER=jira` still takes the Jira arm (`test/reconcile/host.test.mjs:2676` passes unchanged); `PLOT_TRACKER=github-issues` on GitHub still calls `gh`.
- A unit test for the entry's three answers and its usage exit (exit 2 with no argument), in `packages/board/test/unit/`, importing the source as the neighbouring entry tests do.

Plus: contract tests in `test/reconcile/host.test.mjs`; a `plot` patch changeset and an `@plot-pm/board` patch changeset (copy the format from `git log -- .changeset`; the description comes first and the `bumps:` block last); `pnpm build:board` so the artifact matches the source; `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. Run under Node 24 (`nvm use`). Do not run `test:e2e` locally; CI owns it. Re-run a failing file alone before believing a failure.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`; never `gh pr create`. When it exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section — the plan annotates a PR inside the heading for wave plans, as `(Branch: x, PR: #N)`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/adapters/tracker/tracker-listers.ts` and `tracker-resolve.ts`, the new entry and its unit test, `packages/board/build.mjs`, `skills/plot/scripts/plot-host.sh` (`issue-list`, `issue-view` and the new helper only), `test/reconcile/host.test.mjs`, the generated `skills/plot/scripts/board/*.mjs`, and two changesets. It does not own `plot-reconcile-scan.sh`; that is wave 2.

Other branches on `origin` touch files you will touch (verified 2026-10-02 against `origin/main`):

- `bug/a-delta-keeps-the-store-whole` changes `plot-host.sh` and `test/reconcile/host.test.mjs`, and `board-server.mjs`. Expect a textual conflict if it merges first; keep your edit to the `issue-list`/`issue-view` arms and the helper so it stays small.
- `bug/an-empty-branch-is-not-asked` changes `test/reconcile/host.test.mjs`. Add your tests as a new block rather than editing existing ones.
- `feature/a-ci-suite-is-refused-at-a-desk`, `feature/agents-run-their-local-checks` and `feature/the-checks-a-diff-needs` change `packages/board/build.mjs`. Add your target as one self-contained block next to `plot-desk-root.mjs`.
- Every branch that rebuilds the board artifact can conflict on `skills/plot/scripts/board/board-server.mjs`. On that conflict take either side, run `pnpm build:board`, and commit the result (`docs/definition-of-done.md`, *Resolving a board artifact conflict*); never read the diff.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
