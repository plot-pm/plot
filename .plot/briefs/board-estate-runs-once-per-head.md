## Implementation brief — board-status-banner-offline-tickets-and (wave: Estate cost)

- **Plan (canonical):** docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Branch:** `bug/board-estate-runs-once-per-head` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This wave's siblings (`bug/board-status-banner-states` → #2550, `bug/board-offline-tickets-age-and-rows` → #2610) are already merged. `bug/board-build-joins-honour-opts` has a brief but no PR yet. This branch touches disjoint files from all of them (per the plan's Design note) and has no ordering dependency.

### What to build

Three fixes, all in the "Estate cost" group, closing #2318, #2450 and #2453:

1. **`isClean` ignores untracked files and can take an optional lock.** `packages/domain/src/adapters/trees/trees-git.ts:200-203` runs `git -C <path> status --porcelain` with no `--no-optional-locks` and reports dirty on ANY porcelain output — including untracked files. Compare `changedUnder` three lines below it (`trees-git.ts:269-276`), which already runs `['--no-optional-locks', '-C', path, 'status', '--porcelain', '--untracked-files=all', ...]` — `isClean` needs the lock flag for the same reason (concurrent fleet reads must not block on git's index lock) but needs untracked files **excluded** rather than requested, since the finding is that an untracked scratch file currently makes a clean checkout report dirty. Use `--untracked-files=no` (not `=all`) so the flag set differs deliberately from `changedUnder`'s, and say why in a one-line comment — otherwise the next reader "fixes" the asymmetry.

2. **`planEstate` runs once per head change, not once per call.** `planEstate` (`packages/board/src/server/board.ts:2679`) does a full plan-estate read: `collectPlanSources` against `origin/<default>`, a `refs.planAuthors` git-log walk, and — when `Branch prefixes` is set — `collectBranchPlans`, each staging and spawning `plot-plan-meta.sh` over every plan file. Inside `buildFleet` (`fleet.ts:7220`) this already runs ONCE and is shared via `estate.then(...)` across `activeSprints`, `estateTotals` and the draft/spike reads — that part is already right. The duplicate is `planStatusBySlug` (`board.ts:2623`), which calls `planEstate` fresh whenever a caller invokes it without a precomputed `estate` (the `estate ?? await planStatusBySlug(...)` fallback at `fleet.ts:7017` and `fleet.ts:7110` only helps callers that already have one). Any board-status code path that calls `planStatusBySlug` directly, outside a `buildFleet` render pass that already computed `estate`, pays for a second full parse on the same head. Key `planEstate`'s work by the default branch's current tip SHA (read once at entry) the way `branchPlanCache` already keys on branch-tip SHAs (see `board.ts:2671`'s comment on "the same tip-SHA cache") — a repeat call on an unchanged head returns the cached result, a head move invalidates it. Do not cache on wall-clock time; the plan calls this "once per head change", not "once per N seconds".

3. **The redundant `localOnlyPaths` guard in `buildBoard` goes.** `board.ts:2033-2043` builds `localOnlyPaths` from `planSources.filter(src => src.local)`, then `board.ts:2124` and `board.ts:2136` both skip a branch-plan path already covered — `if (localOnlyPaths.has(plan.path)) continue;` immediately followed by `if (planSourcePaths.has(plan.path)) continue;`. Read the two comments at `board.ts:2110-2135` carefully before deleting: `planSourcePaths` (built fresh each call from `planSources`, which already includes every `local` source) is a strict superset of `localOnlyPaths` for this purpose — every path in `localOnlyPaths` is by construction also in `planSourcePaths`, since `local` sources are a subset of all `planSources`. So the first guard never fires without the second also firing, and removing it changes no behavior. Confirm this with a targeted read of `collectPlanSources` before deleting — if `local` sources are ever excluded from `planSources`'s own path set, the guards are NOT redundant and this part of the slice is void (report it rather than deleting).

### Decisions already settled — do not re-derive them

**`--untracked-files=no`, not a plain `git status --porcelain` with no flag.** A naive fix might just add `--no-optional-locks` and stop, leaving untracked files dirtying the read. The finding (#2318) is specifically that untracked files should NOT count against `isClean` — this is a deliberate behavior change, not just a lock-contention fix, and it changes what "clean" means for every caller of `Trees.isClean`. Grep callers (`board.ts:2257` is the only current one) and confirm none depend on untracked-file detection before narrowing the semantics.

**The `rev-parse` and ancestry cost from #2450 is NOT in this slice's scope beyond pinning tests.** The plan's own Open Questions list this as unresolved: "Does the extra `rev-parse` and ancestry cost from #2450 justify a cache after measurement, or does the finding close as measured?" This slice's job is to pin the existing ancestry behavior with tests (`yes` cases and each part of the #2450 fix), NOT to add a new cache for `rev-parse`/ancestry calls. Adding one here would be solving an open question the plan explicitly left open rather than closing — if the measurement clearly justifies a cache, say so in the PR description and let a person decide whether it's in-scope, don't just add it.

**Line numbers are stale by construction.** The plan's Notes say line numbers come from `84b1638e4` and shift. Every line number above was re-read against current `main` on 2026-10-24 (post sibling-slice merges) — re-check them again before editing, since merging this plan's other slices may have shifted things further.

### Done when

The plan's `## Done when` is implicit in its Changelog line: *"the plan-estate walk and the dirty-checkout check run once per head change, take no index lock [contention], and ignore untracked files."* Concretely:

- A test proves `isClean` reports clean on a tree with only untracked files present.
- A test proves `isClean`'s git invocation includes `--no-optional-locks`.
- A test proves two calls to `planStatusBySlug` (or whatever the shared entry point becomes) on an unchanged head produce one underlying `planEstate` computation, not two — this is the assertion a naive "looks fixed" implementation would pass without, since nothing currently fails loudly when the duplicate read happens; it just costs time.
- A test pins each distinct case the #2450 fix covers (ancestry `yes`, and the specific scenario #2450 fixed) so a future change can't silently regress it.
- The `localOnlyPaths` removal (if confirmed safe per above) leaves `buildBoard`'s existing tests green with no behavior change — this is a deletion, not a feature, so no new test should be needed for it; if one seems necessary, that's a sign the removal wasn't actually safe.

Plus: the repo's gates — `packages/board/src/**` changes need `pnpm --filter @plot-pm/board exec vitest related --run {changed}` and `pnpm run typecheck`; `packages/domain/src/**` changes need `pnpm --filter @plot-pm/domain exec vitest related --run {changed}` and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`. No changeset-worthy skill change here, but check `scripts/check-changeset-packages.sh` expectations if you add one for the board/domain package bump. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the exact local checks for whatever you touched. The suites under `CI suites` in `## Plot Config` run in CI only; don't run `test:e2e` locally (see CLAUDE.md Testing section — it dispatches real workers and can take a shared machine down).

Name the shell gate if you touch any `.sh` file: `scripts/check-shell-lines.sh` refuses growth in `skills/`'s shell line count beyond its merge base. This slice is TypeScript-only per the plan's file list, so it likely doesn't apply — but check if your fix touches `plot-worker-state.sh` or similar (unlikely; `isClean` is pure TS).

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads the plan, titles the PR with this wave's heading, and refuses a branch no plan names or one that already carries a PR. Push the first real commit as soon as it exists — don't wait for the whole slice to be done before the branch has any history. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section under `### Estate cost`.

### Scope guard

This branch owns:
- `packages/domain/src/adapters/trees/trees-git.ts` (`isClean`)
- `packages/domain/src/adapters/trees/trees-fixture.ts` (if the fixture needs a matching behavior change for tests)
- `packages/board/src/server/board.ts` (`planEstate`, `buildBoard`'s `localOnlyPaths`/`planSourcePaths` guards)
- Associated test files under `packages/domain/test/` and `packages/board/test/`

Other branches from this plan are merged or not yet started — no live collision to track at dispatch time, but re-check `/plot-pulse` before pushing in case `bug/board-build-joins-honour-opts` picked up overlapping `fleet.ts` edits in the meantime (the plan notes slices 1 and 2 share `fleet.ts`; this slice's own file list does not include `fleet.ts`, so no overlap is expected, but verify).

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, if the `localOnlyPaths` removal turns out NOT to be behavior-preserving, stop and report rather than reshaping the guard logic to make it safe.
