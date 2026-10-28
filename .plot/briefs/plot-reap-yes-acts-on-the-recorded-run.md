## Implementation brief — plot-reap-yes-deletes-a-different (wave 4: Recorded dry run)

- **Plan (canonical):** docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2828 merged
- **Branch:** `bug/plot-reap-yes-acts-on-the-recorded-run` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app required on main)

This is the last of four waves and the only one not yet started. Waves 1 (`bug/plot-reap-pins-every-tip-it-deletes`, #2850), 2 (`bug/plot-reap-names-an-unknown-host-answer`, #2861) and 3 (`bug/plot-reap-keeps-commits-after-the-merge`, #2868) are all merged into `main` as of this brief — this branch can build on their landed shape directly rather than guessing at it. The plan's own line-number citations are pre-wave-1 numbers and no longer match; re-locate by content.

### What to build

`plot-reap --yes` re-decides every local branch, worktree and claim from scratch instead of acting on the set `--dry-run` already showed an operator. On ewz-kus-portal (#2825) this let an operator approve one set and the run delete a different one: a host answer flipped between the two runs, a worktree kind's given-up delete freed a branch the branch kind then also deleted, and `origin/<default>` moved in between. The fix is a **recorded dry run**: `--dry-run` writes down what it decided, under the common git dir; `--yes` acts on the intersection of that record and a fresh, narrow local re-check — never on a fresh full re-decision.

Concretely, in `packages/board/src/server/entry/reap.ts`:

1. **`--dry-run` writes a record.** Repository identity (realpath of `git rev-parse --git-common-dir`), the default branch name, the `origin/<default>` SHA read at `runReap`'s `ctx.fetch(defaultBranch)` (around `reap.ts:1383`), a UTC timestamp, and one row per worktree/branch/claim it decided to act on (`would` rows today), each carrying its kind, identity (worktree path or branch name), tip SHA, and reason.
2. **`--yes` reads the record instead of re-deciding from nothing.** For each kind (worktree, branch, claim) it takes the record's rows for that kind, intersects with a fresh check, and acts only on what survives both.
3. **The intersection rule differs by row kind** (plan Design → Slice 4, and Decisions):
   - **Branch/claim row:** passes when the tip is unchanged since the record, the branch is not checked out *now* (read live — never from the record, since the record predates any worktree created afterward), and it is not the default branch.
   - **Worktree row:** checked out by definition, so it re-runs the *entire* existing worktree-kind live gate (`firstReapRefusal` via `reapProblems` in `packages/domain/src/rules/reapable.ts` — live worker pid, dirty tree, unpushed commits, the given-up arm's fetch-and-recount), exactly as an unrecorded `--yes` does today, **plus** the record's own limit on top: the desk must appear as a recorded row, at its recorded HEAD. A desk where someone started new work after the dry run fails the live gate on its own (dirty tree or unpushed commits) and is kept — no new record-specific worktree check is needed beyond "is this desk a recorded row at its recorded tip."
   - **A row recorded as "PR merged":** re-asked with `ctx.host.prMerged(br)` before deleting. Anything but `merged` keeps the branch with slice 2's reason (`host-unknown` / `host-throttled` / `no-merged-pr` as appropriate) — a hand-added row cannot force a delete the host no longer confirms.
4. **A bare `--yes` with no record acts on nothing** and prints the `--dry-run` command instead.
5. **`--yes --plan-slug <slug>`** (new CLI flag) is the one `--yes` form that needs **no record**: it decides and acts in a single run, scoped to the branches named in that one plan's `## Slices` section and the desks checked out on them, running every live gate from waves 1–3 and this wave's worktree/branch/claim kinds unchanged. It exists because the two unattended callers approve nothing — a record only matters where a human approved a specific set.
6. **`--sweep-temp --yes`** is unaffected — it is a separate mode (see `reap.ts:536` area) and already runs with no record.

### Settled decisions — do not re-derive them

**The record is read by content, not treated as a confirmation-in-place token.** The plan is explicit (Decisions list): "A recorded dry run, not a confirmation in place." `--yes` does not simply trust a hash of "a dry run ran" — it re-derives each row's current state (tip, checked-out-ness, host answer where relevant) and only acts where the fresh check still agrees direction-for-direction with the record. This is why a host flip or a branch deleted by another process can only ever *remove* deletions from what `--yes` does, never add one the dry run never showed.

**The record's own age and origin are refused, not silently ignored.** `--yes` refuses: a record belonging to a different checkout (repository identity must match — mirrors `PinnedTips`'s own git-common-dir resolution, see below), and a record older than a bound. Open question in the plan (`Which bound makes a record too old: Checks wait, or a new key?`) — `Checks wait` (`skills/plot/scripts/plot-config.sh get "Checks wait"`, currently `3600` seconds) is the existing config key for "how long is a host reading still trustworthy," and `default-branch.json`'s own staleness check in `CLAUDE.md`'s *A Decision Reads The Index* section already uses it for exactly this kind of "is this recorded answer still fresh enough to act on" judgment. Reusing it rather than adding a new key is the default unless you find a reason `Checks wait`'s semantics (how long a CI reading stays trustworthy) don't transfer to "how long a dry-run's local-branch snapshot stays trustworthy." If you add a new key instead, say why in the PR.

**No per-branch `--only` flag, by design.** The plan is explicit: "removing rows from the record narrows a run, and adding rows cannot widen it." An operator who wants a smaller `--yes` run hand-edits (removes rows from) the record file; there is no flag to add back what the dry run didn't show.

**The record adapter follows `pinnedTipsFile`'s existing shape, not a new pattern.** `packages/domain/src/adapters/pinned-tips/pinned-tips-file.ts` is wave 1's precedent for "a small record file under the common git dir's `.plot/state/`, resolved via `git rev-parse --git-common-dir` against `cwd`, with a `PLOT_*_HOME` env override for tests (its own is `PLOT_PINNED_TIPS_HOME`)." The new record store should follow the same resolution logic (same reason: a desk and the main checkout must read the same file) rather than inventing a second way to find "the" state directory. Decide whether this is a new file (e.g. `.plot/state/reap-dry-run.json` or similar) or a new port method on an existing one — a new port (e.g. `ReapRecord`) is more likely correct since the shape (one timestamped snapshot, overwritten each `--dry-run`, not appended like `reaped.tsv`) differs from `PinnedTips`'s append-only row log.

**The worktree kind's given-up cascade is what the dry run must show, not hide.** Plan: "The dry run projects the cascade of cause 2: a branch held only by a desk this run removes prints `would — merged into <default>, held only by a desk this run reaps`, and the record carries it." Look at the worktree kind's given-up arm (`reap.ts` around line 816+, `givenUp` / the recount after the given-up delete) and the branch kind's existing `checkedOut` read (`checkedOutResult` / `checkedOut.has(br)` around `reap.ts:1068-1071,1115`) — under `--dry-run` today the branch kind sees the branch still checked out (because `--dry-run` deletes nothing) and may print `keep — checked out`, while a live `--yes` run would have freed it first via the worktree kind. The dry run needs to **simulate** that freeing when writing its branch-kind rows, so the record (and what an operator reads before approving) already reflects what a real `--yes` run would do, not what a `--dry-run` run's own untouched checkouts make it look like.

**Every existing `--yes` caller changes, except `--sweep-temp`.** The plan's full caller table (Design → Approach, after Slice 4) is the spec for this:

| caller | change |
|---|---|
| `packages/fleet/src/shared/auto-deliver.ts:342` (exact line may have moved) | `plot-reap.sh --yes` → `plot-reap.sh --yes --plan-slug <slug>` |
| `packages/domain/src/workflows/reconcile.ts` (`copy-then-reap` repair text) | prints `--yes --plan-slug <slug>` when the desk's manifest names a plan, else the `--dry-run` then `--yes` pair |
| `packages/domain/src/adapters/temp-sweep/temp-sweep-shell.ts` | unchanged (`--sweep-temp --yes`) |
| `skills/plot/scripts/plot-reconcile-scan.sh` | unchanged |
| `reap.ts` help text (`HELP_TEXT`) | names the dry-run-then-yes pair and `--plan-slug`, not a bare `--yes` |
| `docs/stories/the-master-agent-holds-the-fleet/DESIGN-worktree.md` | names the dry-run pair and `--plan-slug` |
| `packages/board/test/unit/registryd-units.test.ts` | a comment claiming no script runs `plot-reap.sh --yes` is wrong once `auto-deliver.ts` does — correct it |
| `packages/fleet/test/unit/auto-deliver.test.ts` | expects `reap --yes --plan-slug <slug>` |
| `test/reconcile/` reap suites (`sweep.test.mjs`, `reap-log`, `reap-manifest`, `reap-agent-liveness`, `reap-failed-readings`, `reap-launcher`, `reap-merged-pr`, `desk-lifecycle`) | each existing unrecorded `--yes` call needs either a `--dry-run` run first (to produce a record) or `--plan-slug` where the fixture has a plan — **71 call sites outside `reap-sweep-temp.test.mjs`** per the plan's count; find them with `grep -rn -- '--yes' test/reconcile/*.test.mjs` and exclude the sweep-temp file |
| `reap-sweep-temp.test.mjs`, `packages/board/test/unit/reap-sweep-temp.test.ts` | unchanged |

Check each file still exists at roughly that location — waves 1–3 may have touched some of them, but none of the three prior waves changed this caller table per their own slice descriptions.

### Done when

The plan's `## Done when` is implicit in Slice 4's Design/Tests sections; treat the Tests section's Slice 4 paragraph as the spec:

- Domain unit: the record-row rule refuses a moved tip, a branch checked out now, the default branch, a foreign repository identity, and an old record.
- Contract (the panel's own reproduction, as a test): `--dry-run`, flip the `gh`/host stub's answer, push one branch to `origin/main`, then `--yes` — assert the deleted set is a **subset** of the dry run's `would` rows (never a superset, never a disjoint set).
- Contract: a branch committed to after the record is refused by name (tip changed).
- Contract: a branch checked out in a new worktree after the record survives (checked-out read live, not from the record).
- Contract: a hand-removed row from the record file is kept (never acted on).
- Contract: a hand-added "PR merged" row is kept when the host stub now answers `not-merged`, and kept as rate-limited when it answers 429/throttled (closes the plan's open question about a hand-added row forcing a delete — it can't).
- Contract: a recorded worktree row whose desk gained an uncommitted file, a live worker pid, or an unpushed commit after the dry run is kept, with the worktree kind's own reason (not a record-specific one).
- Contract: `--yes --plan-slug <slug>` with no record removes that plan's landed desk and branch, and leaves another plan's landed desk and branch alone.
- Contract: a bare `--yes` with no record removes nothing and prints the `--dry-run` command.
- Board unit: a landed, clean desk on a merged branch — the dry run's branch row names the given-up cascade, and `--yes` deletes exactly that row (nothing more, nothing less).
- Fleet unit (`auto-deliver.test.ts`): the reap call becomes `--yes --plan-slug <slug>`.
- Domain unit: `reconcile.ts`'s `copy-then-reap` repair text names `--plan-slug` when the desk's manifest names a plan.
- Characterisation, must still pass unchanged: `branches_deleted` equals the branch section's `deleted` row count (the counter theory from the plan's Motivation was dropped as a cause — don't reopen it).
- `--sweep-temp --yes` with no record still runs exactly as before.

Each exists because a naive implementation (e.g. "just remember the would-rows as a set of names and delete every name still present") passes a casual smoke test but fails the subset assertion, the hand-edit tests, or the "PR merged" re-ask — these are the regression tests for the exact divergence #2825 reported.

Plus: this repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related/changed-file tests and typecheck for `packages/board/**` and `packages/domain/**`, plus the gate tests and `scripts/check-*.sh` scripts. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run them locally as a matter of course; a failure there comes back as a correction.

**`scripts/check-shell-lines.sh` likely matters here**, unlike wave 3: this wave touches `skills/plot/scripts/plot-reconcile-scan.sh`'s printed repair text and may touch `packages/fleet/src/shared/auto-deliver.ts`'s shell invocation string — check whether either is a `.sh` file under `skills/` that the gate counts, and if a shell file grows, pay for it in the same change (remove shell elsewhere, or move logic into the domain) per `CLAUDE.md`'s *A Shell Script Asks The Domain*.

### Bookkeeping

Open the PR through the controller once there's a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and titles the PR from the plan's wave heading ("Recorded dry run"). Do not run `gh pr create` directly. Push the first real commit as soon as it exists — don't wait for the whole slice to be done before pushing.

When the PR is created, append `→ #<number>` to this branch's line under the `### Recorded dry run` heading in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/board/src/server/entry/reap.ts` — the record write (new, at the end of a `--dry-run` run), the record-intersection re-check inside `runBranchKind`, `runWorktreeKind`, and the claim kind under `--yes`, the new `--plan-slug` CLI flag and its parsing (`parseArgs`, `Args` interface around `reap.ts:60-82`), and the help text
- A new domain port/adapter for the record store (likely under `packages/domain/src/ports/` and `packages/domain/src/adapters/`, following `pinned-tips`'s shape) plus a pure rule answering `(recorded row, live readings, fresh host answer) → delete | keep(reason)` — probably in `packages/domain/src/rules/sweepable.ts` or a new sibling file
- `packages/fleet/src/shared/auto-deliver.ts` — the reap invocation gains `--plan-slug <slug>`
- `packages/domain/src/workflows/reconcile.ts` — the `copy-then-reap` repair text
- `skills/plot/scripts/plot-reconcile-scan.sh` — unchanged per the plan's caller table (double check; do not touch unless you find the plan's table is wrong)
- The ~71 `--yes` call sites across `test/reconcile/*.test.mjs` (excluding `reap-sweep-temp.test.mjs`) and the corresponding board/fleet unit tests named in the caller table above

Other branches on this plan are all merged — there is no sibling in flight to coordinate with. This is the last wave; once it merges, `/plot-deliver plot-reap-yes-deletes-a-different` closes the plan.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
