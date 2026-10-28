## Implementation brief — plot-reap-yes-deletes-a-different (wave 1: Recoverable deletes)

- **Plan (canonical):** `docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md` on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2828 merged
- **Branch:** `bug/plot-reap-pins-every-tip-it-deletes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 1 of 4. Waves 2 (`bug/plot-reap-names-an-unknown-host-answer`), 3 (`bug/plot-reap-keeps-commits-after-the-merge`) and 4 (`bug/plot-reap-yes-acts-on-the-recorded-run`) wait on this one. All four change `runBranchKind` in `packages/board/src/server/entry/reap.ts`, so the wave order is what keeps them from colliding.

### What to build

`plot-reap --yes` runs `git branch -D` (`trees-git.ts:486-487`) and discards the tip it prints. On ewz-kus-portal (issue #2825) the operator recovered deleted tips only by pinning every dangling commit by hand. This slice makes every local delete recoverable: before each delete, write the tip to `refs/plot/reaped/<branch>/<sha>` and append one row (ref, SHA, UTC write time) to `.plot/state/reaped.tsv` under the common git dir. No pin, no delete: if the ref write or the row append fails, keep the branch with `keep — could not pin the tip`. Each `deleted` row prints `restore: git branch <branch> refs/plot/reaped/<branch>/<sha>`. The next run deletes each reaped ref whose TSV row is older than 30 days and removes that row. The plan is canonical; this is orientation.

The three delete sites in `reap.ts` are the worktree kind's given-up arm (`:911`), the branch kind (`:1048`) and the claim kind (`:1171`). All three pin; a pin at one site only leaves the other two losing tips.

### Settled decisions — do not re-derive them

- **The ref name ends in the SHA.** `refs/plot/reaped/<branch>/<sha>` keeps `feature` and `feature/x` from clashing as file and directory (`refs/plot/reaped/feature` would block `refs/plot/reaped/feature/x`), and keeps both tips when one name is reaped twice. A second pin at the same tip writes the same ref and counts as pinned. One clash remains by design: a branch whose last component is a full 40-hex SHA that another reaped branch used as its leaf. Its pin write fails and the branch stays.
- **A ref, not a log.** `git gc` keeps objects a ref reaches; it does not keep a log's entries.
- **Age comes from `.plot/state/reaped.tsv`, nothing else.** Not a reflog: git keeps none for `refs/plot/*` under `core.logAllRefUpdates=true`, and `gc.reflogExpire` belongs to the repository owner. Not the commit date: that is when the commit was made, not when it was pinned. A reaped ref with no TSV row has no known age, and the prune keeps it.
- **The delete stays `git branch -D`.** It refuses a checked-out branch. `git update-ref -d <ref> <old>` deletes a branch checked out in a worktree (exit 0, measured), so replacing `branch -D` with it would remove the refusal. Pinning the tip never replaces that refusal.
- **`listBranches` does not read `refs/plot/reaped/*`**, and the default refspec does not push `refs/plot/*`. Keep both true.
- **The summary counters are correct as designed** (plan, Motivation): `branches_deleted` increments only beside a `deleted` row. Do not "fix" them; the characterisation test in wave 4 holds this.
- **Layering:** record I/O lives in the entry or an adapter, never in `packages/domain/src/rules/`. The domain may import `zod` and nothing else outside `adapters/`; the purity gate and the spawn ratchet (`allowed=28`) are in CI. Do not add a direct `spawn`/`execFile` outside `adapters/`.
- **Style:** new functions are arrows. Do not convert neighbours.

### Done when

The plan's wave entry is the specification: pin before delete at `reap.ts:911,1048,1171`; no pin, no delete; a restore command per `deleted` row; a 30-day prune; the checked-out refusal kept; `skills/plot/scripts/README.md:49` ("Branches and refs are untouched") corrected.

Tests the plan names, each catching a failure a naive implementation passes:

- Board unit: export `runBranchKind` as `runWorktreeKind` already is (`reap.ts:670`) and drive it with a fake `Context` (pattern: `packages/board/test/unit/reap-given-up-desk.test.ts`). Assert the reaped-ref write precedes `trees.deleteBranch` and carries the PRE-delete SHA (catches pinning after the delete, when the tip is already gone). A fake whose pin write fails never reaches `trees.deleteBranch` and the row reads `keep — could not pin the tip`; the same when the `reaped.tsv` append fails (catches a pin that is best-effort).
- Contract in `test/reconcile/sweep.test.mjs`: after `--yes`, `git rev-parse refs/plot/reaped/<branch>/<sha>` equals the old tip and still resolves after `git gc --prune=now` (catches a pin that is a ref in name only). One test per delete site (`:911,1048,1171`). The printed restore command recreates the branch at that SHA. `feature` and `feature/x` reaped in one run both get a pin. One branch name reaped twice at two tips keeps two pins.
- Prune: a reaped ref whose TSV row is 31 days old is gone after the next run, with its row; one at 29 days stays; a reaped ref with no row stays.

Plus the repo gates: `node skills/plot/scripts/board/plot-local-checks.mjs` before each push, and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset (description first, `bumps:` block last, `plan:` line inside the block) per `CLAUDE.md` Versioning. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file (`plot-host.sh` changes belong to wave 2). Do not commit a rebuilt board bundle (`scripts/check-no-bundle-diff.sh`). Run local tests with no board open on the machine.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/server/entry/reap.ts` (the three delete sites and the prune), the reaped-ref and TSV helpers (entry or adapter), `skills/plot/scripts/README.md:49`, `test/reconcile/sweep.test.mjs`, `packages/board/test/unit/` reap tests, and a changeset.

Not this branch: `plot-host.sh` and `LocalBranchReadings` (wave 2); `prMergedHeads`/`unpushedPatches` in the branch kind and the `CLAUDE.md` / `refs-git.ts:763` amendments (wave 3); the dry-run record, `--plan-slug`, `auto-deliver.ts`, `reconcile.ts` (wave 4). If you find something the plan did not anticipate, report it rather than improvising outside scope.
