## Implementation brief — branchclaims-reads-file-list-lines-in

- **Plan (canonical):** docs/plans/2026-11-07-branchclaims-reads-file-list-lines-in.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3218 merged
- **Branch:** `bug/branchclaims-reads-file-list-lines-in` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `plot/review` through the review app; plan `Review: pr`

One slice, one branch (wave "Fix"); nothing waits on it and it waits on nothing. Issue #3213.

### What to build

`branchClaims` (`packages/domain/src/rules/cross-repo-reference.ts:56`) reads every top-level `` - `<token>` `` line in `## Slices`, `## Branches` and `## Waves` as a branch claim, through `LIST_CLAIM` (line 39). A file-list line such as `` - `skills/plot-fleet/SKILL.md` `` under `### Tests` becomes a claim with `reference: null`. `releasePr` (`rules/release-tag.ts:62`) answers `none` for it, and `plot-deliver --release` refuses with "names no '→ #N' annotation". Measured 2026-11-07 during the 2.31.0 booking sweep: 6 of 27 plans refused, although every real slice line carried a merged PR.

The fix: a list line is a claim only when its token starts with an entry of `Branch prefixes`, the test `plot-plan-meta.sh` applies (`prefixes='idea|feature|bug|docs|infra'`, line 329). `branchClaims` takes the prefix list as a parameter, and the four callers pass it in: `board/src/server/entry/deliver.ts:783`, `entry/release-chain.ts:193`, `entry/slice-claims.ts` (the `plot-slice-claims.mjs` entry that `plot-impl-status.sh:78` runs) and `domain/src/transitions/sprint-member.ts:152` (`planFirstBranch`). Add a corpus test at `packages/domain/corpus/` that runs `branchClaims` and `plot-plan-meta.sh` over `docs/plans/` and fails on a disagreement. The six refused plans join it as fixtures. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The domain takes the prefixes as a parameter and holds no configuration.** Each caller reads `Branch prefixes` itself. The board already does so (`board.ts:2412`, `entry/approve.ts:238` with default `'idea/, feature/, bug/, docs/, infra/'`). `corpus/production.ts:318` is the corpus-side reading.

**A missing `Branch prefixes` key uses the default `idea|feature|bug|docs|infra`.** The domain holds that list once and the shell keeps its copy under the corpus comparison. With no default, every repository without the key loses all its list claims. Settled by jwloka, 2026-11-07.

**A list line carrying `→ owner/repo#N` is a claim whatever its prefix.** An `Impl: other repo` slice names a branch in another repository, which can use a prefix this repository does not declare. Without the rule such plans lose their branches. Settled by jwloka, 2026-11-07.

**`HEADING_CLAIM` (`(Branch: <name>)` in a heading) stays unchanged.** It names a branch explicitly.

**Do not make the shell the authority, and do not adjust either side to make the corpus pass.** Per `docs/shell-and-domain.md`, a duplicated rule joins the corpus tier, and on a disagreement the branch stops. Name both answers and the subject, for example `branchclaims-vs-plan-meta :: <slug> :: rule=[…] shell=[…]`. The corpus tier runs with no host token (`corpus/no-host-token.ts`).

**Carried-over invariants.** `plot-plan-meta.sh` excludes tokens holding `.` after the prefix (file paths), `*` (globs) and `idea/` (names a plan). Read that function (`unread_branch_token`, around line 1063) before choosing the domain's test, and make the corpus show whether the two agree on those tokens. A prefix match is on the token's start, not a substring (`mifeature/x` is no branch). A refusal path must never read "no claims" as "no PR": absent is not false.

### Done when

The plan's `## Slices` entry and the Motivation list are the specification. Lift these assertions, each of which a naive implementation would pass without:

- A plan whose `### Tests` and `### Documentation` list file paths yields only its real branches. Catches the original defect.
- A repository with no `Branch prefixes` key still yields `bug/…` claims. Catches a filter that defaults to an empty list and drops everything.
- A list line `` - `other/x` … → owner/repo#7 `` is still a claim. Catches a filter that checks the prefix only.
- A `(Branch: x)` heading claim is unaffected by the prefix list.
- The corpus test reads all of `docs/plans/` including the six named plans: `continue-and-the-agent-panel-refuse`, `controller-gate-refuses-read-only-commands`, `open-plot-review-findings-from-the`, `partial-board-pulse-reported-as-unknown`, `plot-fleetctl-stop-unloads-another-checkout`, `restart-refuses-unknown-branch-when-it`.
- Each of the four callers is covered by a test showing it passes the prefixes. Mutation-test the corpus gate before believing it: revert the filter and confirm it fails by naming the plan.

Plus the repo gates: the board artifact rebuilds (`packages/board` imports the domain), but a PR's diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`), so run `pnpm build:board` only to test locally and restore generated paths before pushing. Add a changeset: description first, `bumps:` block last, package `plot` or `@plot-pm/board`. The domain package takes arrow functions and factual TSDoc (no decision history in comments). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the slice touches a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override. This slice should need no shell change: `plot-slice-claims.mjs` takes the prefixes as an argument or environment value that `plot-impl-status.sh` passes, so check that `plot-impl-status.sh` stays at or below its current line count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to the branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. After the fix merges, the repair is operational and outside this PR: re-run `POST /api/release {"slug":"<slug>","version":"2.31.0"}` for the 6 plans.

### Scope guard

This branch owns `packages/domain/src/rules/cross-repo-reference.ts`, its callers listed above, `packages/board/src/server/entry/slice-claims.ts`, `skills/plot/scripts/board/plot-slice-claims` wiring, the new corpus test in `packages/domain/corpus/`, the changeset, and the README row for any changed script. No other branch of this plan exists. Verified 2026-11-07: no commit since the plan's approval touched `cross-repo-reference.ts` or `release-tag.ts`, and `slice-claims.ts`'s `branchClaims` import is the same. If you find something the plan did not anticipate, report it rather than improvising outside scope.
