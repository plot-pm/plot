## Implementation brief — the-fleet-sees-a-plan-on-its-own-branch (wave 1: The scan reads a branch's own plans)

- **Plan (canonical):** `docs/plans/2026-09-24-the-fleet-sees-a-plan-on-its-own-branch.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Issue:** #972
- **Branch:** `bug/the-scan-reads-a-branch-s-own-plans` (base: `main`) — claimed 2026-09-24 by ref push at `origin/main`
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

The plan has one slice. Nothing waits on it and it waits on nothing. `bug/a-row-with-no-plan-is-not-a-plan` (#973) is in flight beside it and owns the rendering of the rows this slice does not fix.

### What to build

A plan created with `Impl: same branch` lives only on its work branch until that branch merges. `/api/board` shows it as a Draft card; `/api/fleet` shows the same branch as `{"plan": "", "planFile": "", "phase": null}` under NOT STARTED. The cause is one sentence in `plot-fleet-scan.sh:122`: *"Plans are enumerated from `origin/<main>`."*

The fix is in the shell scan, not the board. After the scan lists plans from `origin/$MAIN` (the `cand_ids`/`cand_reads` loop at `plot-fleet-scan.sh:3007-3016`), it also lists plan files from each prefixed remote branch's tree, keeps only those the default branch does not carry, and appends them to the same candidate arrays **before** the one `parse_plan_estate` call at `:3025`. From there the existing pipeline carries the plan: the plan names its branch in `## Slices`, the pulse emits it, and `fleet.ts` no longer reaches that branch through the plan-less loop at `packages/board/src/server/fleet.ts:7153`.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**Copy the board's dedup, do not invent one.** `readBranchPlans` at `packages/board/src/server/board.ts:802-831` is the reference implementation: `onDefault` = plan paths on `origin/<default>`; for each branch, skip a path that is in `onDefault` or already `seen`. Two branches cut from one point carry the same plan file, and without `seen` one plan reports as several — the board measured and fixed that. Port the rule to bash; do not call the board.

**Regular blobs only, never mode 120000.** `planPathsInTree` (`board.ts:763`) keeps `100644`/`100755` entries ending in `.md`. A symlink blob holds its target path as content, so parsing one hands the parser a line of text, and `active/` links would double-count every indexed plan. List `$PLAN_DIR` only, with modes (`git ls-tree -z <ref> -- "$PLAN_DIR"`).

**The real size is ref-parameterisation, not the loop.** `ref_ls` (`:2456`), `ref_mode_of` (`:2513`), `PLAN_MODES` (`:2508`, plus the perl batch materialiser at `:2543`) and `ref_plan_file` (`:2568`, with `git show "origin/$MAIN:…"` at `:2577` and `:2618`) are all hardcoded to `origin/$MAIN`. A branch plan needs the same read against `origin/<branch>`. Either give these helpers a ref argument (default `origin/$MAIN`, so existing callers are unchanged) or add one narrow branch reader beside them. Symlink resolution does not arise for branch plans because symlinks are filtered out first — do not port the ref-space symlink walk to branch reads.

**One parse for the whole estate.** `:3000-3005` states the constraint: the estate is parsed in ONE `parse_plan_estate` call, so every branch blob must be materialised into `cand_reads` before `:3025`. A second `parse_plan_estate` call for branch plans breaks the `plan_meta_index_of` lookup at `:3518`.

**The identity may stay the relative path.** The loop at `:3505` parses `plan_reads[i]`, never re-reads by the identity in `plans[i]`, so a branch plan's id can be its `docs/plans/…md` path. The dedup guarantees it does not collide with a default-branch plan.

**No narrowing to PR-less branches.** The slice line in `## Slices` still says *"narrow to PR-less branches if the cost demands it"*; the Design section withdrew that (*"The narrowing to PR-less branches is withdrawn"*). The Design wins. Measured: 15 remote refs here, 3 under a configured prefix, one `ls-tree` over the plan dir ≈ 0.00 s, the whole addition 0.24 s (0.4 % of the scan).

**Which branches.** Remote refs from `REMOTE_REFS` (`:670`, already read once) whose name matches `PREFIX_RE` (`:293`) — the same population the board calls "a prefixed branch". Do not run a second `for-each-ref`.

**Rules carried over unchanged:**
- An unreadable branch ref contributes nothing, silently — an empty set, as `planPathsInTree` returns. It never produces a blank or guessed plan.
- An empty or unreadable blob is skipped, not parsed (`board.ts:817-822`).
- A file whose phase does not parse is not a plan — `add_plan_by_phase` already enforces this; route branch plans through it.
- Worktree mode (`PLAN_SOURCE=worktree`, the `else` arm at `:3017`) is out of scope: it reads the checkout, which already holds the current branch's plans.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **Two branches carrying one plan file report one plan.** A fixture with one branch passes with or without `seen`; the test needs two branches cut from the same commit that both add the same plan file, and must count one plan in the `--json` output.
- **A plan on both the default branch and a branch reports once, from the default branch.** Catches an implementation that dedups branch-vs-branch but forgets `onDefault`.
- **A branch's `active/` symlink is not a second plan.** Catches a listing without the mode filter.
- **A branch with no plan anywhere still reports `plan: ""`.** Catches an implementation that attributes a branch to the nearest plan instead of the plan that names it.
- **Measured cost, before and after, in the commit message**, against the **44.4 s** baseline the plan measured — not the 18.3 s the draft quoted. Measured again at dispatch: `--next` ran 48.1 s wall, 2.6 s CPU. Measure the full `--json` run on a quiet machine, twice each side.

Plus the repo gates:

```bash
nvm use                       # Node 24; pnpm crashes on 26 (or: corepack pnpm)
pnpm install
pnpm test
pnpm run test:contracts
pnpm run test:board           # scan tests live in packages/board/test/*.test.mjs (plan-source, read-ref, discovery …)
pnpm run typecheck
```

`test:e2e` is CI's gate — do not run it locally. A changeset: package `plot`, description first, `bumps:` last with `plot: patch`, and `plan: docs/plans/2026-09-24-the-fleet-sees-a-plan-on-its-own-branch.md`. Run `./scripts/check-changeset-packages.sh`. Do not commit a rebuilt `board-server.mjs` unless `packages/board/src` changed; this slice should not change it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the branch line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh`, a new or extended test under `packages/board/test/`, and one changeset.

In flight at dispatch (2026-09-24), verified by diffing each remote branch against its merge base:

- **No other branch touches `plot-fleet-scan.sh`.**
- `bug/a-row-with-no-plan-is-not-a-plan` (#973), `bug/the-board-shows-the-tick-age`, `feature/a-finished-plan-writes-its-issue-status` and `feature/one-monitor-watches-the-slice` touch the built bundles under `skills/plot/scripts/board/`. If this branch leaves `packages/board/src` alone, it does not collide with them.

Not this slice:

- The rendering of the plan-less rows that remain (#973).
- A plan that does not name its own branch in `## Slices`: it becomes a visible plan and its branch stays plan-less. That is #973's population.
- `--next <slug>` for a same-branch plan: its slug lookup at `:2901-2906` reads `ref_ls` on `origin/$MAIN` only. If the ref-parameterisation makes this trivially reachable, report it in the PR rather than extend scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
