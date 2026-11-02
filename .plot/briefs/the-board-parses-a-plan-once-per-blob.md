## Implementation brief — the-board-starts-processes-on-the (wave: Held parse)

- **Plan (canonical):** [docs/plans/2026-11-01-the-board-starts-processes-on-the.md](../../docs/plans/2026-11-01-the-board-starts-processes-on-the.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3018 merged
- **Branch:** `feature/the-board-parses-a-plan-once-per-blob` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review on `main`)

Waits on `feature/the-board-reads-git-through-cached-refs` (#3034, **merged**) — this slice builds on the one `WalkCache` per `cacheKey(opts)` that slice put on the board, and must not pre-build its own. `feature/the-board-holds-its-config` (#3030) runs beside this one and touches disjoint files; this is the last slice of the plan.

### What to build

`buildBoard` re-parses the whole plan estate on every `/api/board` request through `plot-plan-meta.sh`, even though a plan's parsed `PlanMeta` depends only on its blob — unchanged plans are parsed again anyway. Two call sites do this: `readPlanMeta` (`board.ts:1501`, called from `board.ts:2365` and `:2963`), which runs the parser over every staged ref-plan plus branch-plan on each call, and `planMetasAtDefault` (`fleet.ts:1589`), whose own cache (`planMetaCaches`, a `Map<string, {key, metas}>` keyed by the whole estate's combined digest) invalidates and re-parses ALL plans the moment any one blob or any one draft branch tip moves — 626 plans, one 0.52 s CPU parse, every time one plan changes.

This slice makes the parse itself per-blob: hold the parsed `PlanMeta` in the board's existing `WalkCache` (the one `feature/the-board-reads-git-through-cached-refs` built), keyed by blob oid the same way `cachedPlans`'s `parses` kind is keyed in the domain — but as a *sibling* kind, not a reuse of that kind.

1. Add a `PlanMeta`-typed kind to `WalkCache` in `plan-walk-cache.ts` (`freshWalkCache()`'s `kinds` object), keyed by `(blob oid, path, prefixes, parser hash, config digest)` — the same key shape `cachedPlans`'s `parses` field already uses for `PlanRecord` (`plan-walk-cache.ts:373-388`), but a distinct `OidCache<PlanMeta>` field, because `PlanMeta` carries fields `PlanRecord` does not (see Decisions).
2. In `board.ts`, change `readPlanMeta` (or its caller) to split `files` into ones whose blob oid is already held and ones that are not, stage and call `plot-plan-meta.sh` on only the missed ones, and merge held + freshly-parsed into the returned `PlanMeta[]` in the original order. A plan read from a ref is keyed by the blob oid `listBlobs`/`readBlobs` already resolved; a plan read from the working tree (draft branches, staged branch-plans) is keyed by a blob id computed in-process from its bytes (`git hash-object`'s algorithm, not a shell call) — not cached by mtime, because a working-tree file can change without its mtime changing in some git workflows (and the plan requires computing the id in-process, not shelling out).
3. In `fleet.ts`, make `planMetasAtDefault` read through the same per-blob held parse instead of its own whole-estate `planMetaCaches` map: when the estate's key (ref oid + draft tips) is unchanged, return the same cached result as today (no behaviour change there); when it changes, only the plans whose blob actually differs from last time get parsed again — the rest come from the `WalkCache`'s per-blob kind. Remove `planMetaCaches` once nothing reads it.
4. Add `Tracker` to the parse digest (the `config digest` component of the key) in both the board's parse-key builder and `fleet-scan.ts:720`'s digest, because `plot-plan-meta.sh`'s `issues` output depends on the `Tracker` config value (`plot-plan-meta.sh:366-385`) — a `Tracker` change must invalidate every held parse, board-side and walk-side, in the same change.
5. Make `ticketLaneData` run once per request: it is currently called once at `index.ts:493` (now inside `boardAnswer`) and again inside `discoveryLanes` (`discovery-lanes.ts:49`), each run re-deriving `planMetasAtDefault`'s cache key before reading the cache (`Plan directory` config, `defaultBranchOf`, `refs.resolve`, `branchTips`, a `Tracker` read). Compute it once in `boardAnswer` and pass the answer into `discoveryLanes` as a parameter instead of letting it call `ticketLaneData` again.

### The decisions the plan settles — do not re-derive them

**A sibling kind, not a reuse of `cachedPlans`/`readPlansAt`.** `cachedPlans` (`plan-walk-cache.ts:373`) wraps the domain's `PlanStore.readPlansAt`, which returns `PlanRecord` — the domain's own plan shape, read by `plan-walk-estate.ts:103` for the oid-keyed walk (ancestry, merge subjects, additions). The board's plans come from a different pipeline entirely: `scriptsFor(opts).planMeta(files, …)`, which shells to `plot-plan-meta.sh` and returns `PlanMeta` — a richer, board-specific shape (verified: `grep -rn "readPlansAt\|planStoreFor(" packages/board/src` finds `planStoreFor` used only for the held-config read in `index.ts:176`/`server-info.ts:120`, never for plan parsing). The two pipelines cannot be merged without a parser-contract change the plan explicitly declines (Design §6: "the board cannot read `parses` without a parser contract change; it shares the key rule, the store and the sweep instead"). So this slice adds a new `OidCache<PlanMeta>` field to `WalkCache`, following `cachedPlans`'s key-shape precedent, not a cast or a wrapper around the existing `parses` field.

**A working-tree plan is keyed by an in-process blob id, never by mtime.** The plan's Design §6 is explicit: "A plan from the working tree is keyed by its git blob id, computed in-process from its bytes." This applies to every draft-branch plan and every branch-plan staged from an idea/feature branch — anything `collectBranchPlans`/`draftPlanFiles` reads that is not already a `(sha, path)` pair from `listBlobs`. Compute the blob id the same way git does (`sha1`/`sha256` over `blob <len>\0<content>`, matching the repository's object format) — do not shell to `git hash-object`, and do not use `fs.statSync(...).mtimeMs` as a substitute key; the plan rules mtime out specifically because a working-tree file can be rewritten without its mtime changing.

**`planMetaCaches`' whole-estate invalidation is the defect this slice fixes, not a design to preserve.** Today, `planMetasAtDefault`'s cache (`fleet.ts:1656`) holds one `{key, metas}` pair per `cacheKey(opts)`, where `key` folds in every blob's oid and every draft tip — so ANY single change anywhere in the estate throws away ALL 626 parses. The fix keeps the function's existing *return contract* (same `PlanMeta[] | null`, same ordering, same null-on-failure semantics) while changing what backs it: the per-blob `WalkCache` kind, not a single combined-key map. Verify `planMetasAtDefault`'s current null-handling paths (`listBlobs` failure, `readBlobs` failure, parser failure) before touching them — each must still return `null` exactly where it does today; only the happy path's granularity changes.

**The config digest gains `Tracker` in both places in the same change — this is a stated coupling, not two independent additions.** The plan's Design §6: "The config digest gains `Tracker`, because the parser's `issues` output depends on it (`plot-plan-meta.sh:366-385`); the walk's digest at `fleet-scan.ts:720` gains it in the same slice." A `Tracker` edit that invalidates the board's held parses but not the walk's (or vice versa) would let one side serve a parse keyed to a config that no longer matches — verify both digest builders read `Tracker` from the same config read before considering this done.

**`ticketLaneData` runs once; `discoveryLanes` takes the answer, not the function.** Change `discoveryLanes`'s signature to accept the already-computed `ticketLaneData` result as a parameter (its current internal call at `discovery-lanes.ts:49` goes), and update `boardAnswer` to compute it once and pass it to both the board's own topics and `discoveryLanes`. `keptClosedRows` and `ensureCache`, `discoveryLanes`'s other imports from `fleet.js`, are unaffected — only the `ticketLaneData` call moves.

**This slice does not touch `.claude/agents/`, the config decorator, or the ratchet test's assertions beyond the one row below.** `feature/the-board-holds-its-config` (merged separately, may or may not have landed by the time this branch opens its PR — check `git log origin/main` before assuming either order) owns the config-reading routes. This slice's only edit to `board-request-starts.test.ts` is removing the `plot-plan-meta.sh` and second-lane lines from the warm-request list, per the Done-when row below — not restructuring the test.

### Done when

The plan's `## Done when` table names the Held-parse rows precisely — implement to those, not a paraphrase:

- A plan is parsed once per blob: two builds at one oid parse every plan once, then zero; after one plan file changes, only that plan is parsed again (`packages/board/test/unit/fleet.test.ts`).
- A `Tracker` config change re-parses every plan (`packages/domain/test/plan-walk-cache.test.ts`).
- The lanes run once per request: a counting `ticketLaneData` fake sees exactly one call from `boardAnswer` (`packages/board/test/unit/fleet.test.ts`).
- The warm-request list reaches the plan's end value: exactly `git for-each-ref` and `git status --porcelain`, nothing else (`packages/board/test/unit/board-request-starts.test.ts` — the same ratchet file the Proof slice built and the prior two slices have been subtracting from).

Plus: the repo's gates — no committed `board-server.mjs` diff, a changeset naming `plot` or `@plot-pm/board`, and the domain package's arrow-function and TSDoc conventions for every new/touched export in `packages/domain/src/`. For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps `packages/domain/**` and `packages/board/**` changes to their suites and typechecks. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows past its merge base. This slice is TypeScript-only (`plan-walk-cache.ts`, `board.ts`, `fleet.ts`, `fleet-scan.ts`, `discovery-lanes.ts`) — it should touch no `.sh` file, so the gate should not fire. If a change here does end up touching shell, that growth is paid for in the same change.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch shows activity.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/the-board-parses-a-plan-once-per-blob` under `### Held parse`).

### Scope guard

This branch owns: the `PlanMeta`-typed `WalkCache` kind and its key rule in `plan-walk-cache.ts`; `readPlanMeta`'s (or its caller's) split into held/missed blobs in `board.ts`; `planMetasAtDefault`'s rewrite onto the per-blob kind and `planMetaCaches`' removal in `fleet.ts`; the `Tracker` addition to both the board's parse-key builder and `fleet-scan.ts:720`'s digest; `ticketLaneData` running once per request with `discoveryLanes` taking the answer as a parameter; and the ratchet list's final two lines (`plot-plan-meta.sh` and the second-lane cost) going.

It does not own: the config decorator or the four config-reading routes (`feature/the-board-holds-its-config` — disjoint files: `packages/domain/src/adapters/scripts/`, `config-reader.ts`, `server-info.ts`); the `WalkCache` instance's lifecycle on the board, `cachedRefs`, or the `recordCommit`/`planAuthors`/`countBehind`/`defaultBranch` kinds (`feature/the-board-reads-git-through-cached-refs`, already merged as #3034 — read its `WalkCache` as the thing this slice extends, not something to recreate); the ratchet test itself or `boardAnswer` (`feature/a-board-request-counts-its-processes`, already merged as #3020).

`fleet.ts` changed in 24 commits in one week per the plan's Notes — rebase onto `origin/main` before review rather than assuming the file is as last read. Confirm `feature/the-board-holds-its-config`'s state on `origin/main` (merged, open, or not yet started) before this branch opens its PR, since both slices may touch `BuildBoardOptions` in `board.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
