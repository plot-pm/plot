## Implementation brief — the-plan-walk-moves-into-the (wave: Estate)

- **Plan (canonical):** [docs/plans/2026-10-31-the-plan-walk-moves-into-the.md](../../docs/plans/2026-10-31-the-plan-walk-moves-into-the.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-walk-reads-the-estate` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan `Review: pr`

This is the plan's first slice — every later slice (`the-walk-reads-the-branches`, and down the chain) `waits:` on it. Nothing to merge ahead of it; everything after it blocks on this one.

### What to build

The domain plan walk replaces `plot-fleet-scan.sh`'s per-beat shell re-derivation (measured 27.7–30 s CPU at load 8–10) with one in-process pass. This slice builds the walk's first stage — the **estate**: which plans exist, read by git object id rather than by re-walking the working tree or re-asking a ref name on every call.

Concretely:

1. Add a `PlanStore` operation that parses plan blobs **by oid** — given a set of `{ sha, path }` pairs (the beat's own snapshot), parse them with one batched spawn, the way `planStoreRef.readPlans` already batches `readBlobs` + one parser spawn, but taking oids handed in rather than re-reading `listBlobs(ref, planDir)` inside the call.
2. Add the branch-only-plans enumeration: plans that exist only on a prefix branch (`idea/`, `feature/`, `bug/`, `docs/`, `infra/` — configured, not hardcoded), recomputed whenever any prefix ref moves.
3. Add the index read: `docs/plans/active/` and `docs/plans/delivered/` symlink targets, from the same tree snapshot.
4. Fix `plan-store-ref.ts` in place — see the three defects below. This is not new scope; it is the existing adapter the walk must read through, and it breaks the walk's own invariants today.

### The decisions this slice must carry — do not re-derive them

**Why oid-keyed reads, not ref-name reads.** A cache (built two slices from now, in `feature/the-walk-caches-by-oid`) can only be correct if every read it holds is "the parse of blob X", never "the parse of whatever `origin/main` currently points to". `plan-store-ref.ts:69-77` today calls `refs.listBlobs(ref, planDir)` — by the ref **name** `origin/main` — separately inside `listPlans` and inside `readPlans`. A fetch landing between the beat's snapshot and this call gives a blob from a tree the snapshot never saw. This slice must add the oid-taking operation now, even though no cache exists yet, because every later stage composes on top of this one's shape — retrofitting the key after the Branch-readings and Desk slices have already built on ref-name reads would touch all of them.

**Three defects in `plan-store-ref.ts`, named by the panel's safety verdict (`.plot/panels/the-plan-walk-moves-into-the/safety.md` §3) and binding on this slice:**

1. **Reads by ref name, not oid** (`plan-store-ref.ts:61,69-77`). Fix: add a port operation that parses blobs given oids the caller already holds (reusing `refs.readBlobs(shas)`, `refs.ts:432`, which already exists and is already batched) — never re-call `listBlobs` inside the read.
2. **Parses without `--prefixes`** (`plan-store-ref.ts:111`, `planStoreShell` likewise). The parser's call site passes no `--prefixes`, so it silently falls back to the default `idea|feature|bug|docs|infra` (`plot-plan-meta.sh:329`). This repository happens to use that default, so a same-repo corpus test cannot catch the gap — a fixture with a **non-default** prefix list is required to prove the fix, because the default masks it. `plot-fleet-scan.sh:3111` already passes `--prefixes "$PREFIX_RE"`; the walk's parse call must do the same, reading the configured value rather than assuming it.
3. **An unreadable ref silently answers "no plans"** (`plan-store-ref.ts:62-66`, `:89`, `:110`). `listPlans` returns `[]` when `listBlobs` fails; `readPlans` drops a missing blob or parse error with no failure signal. The shell scan does the opposite on the same condition: when `origin/<main>` can't be read it falls back to the **working tree** (`plot-fleet-scan.sh:2716-2717`, reported as `plan_source: worktree`) rather than reporting zero plans. An empty answer here is indistinguishable from "the repository truly has no plans" and the board would silently drop every plan the moment a fetch glitches. This is the same shape as `claimedBranches`' existing rule — "unreadable must never mean nothing is claimed" — reapplied to the estate: the walk must either fail the beat outright, or reproduce the working-tree fallback (which, having no tree oid, must bypass whatever cache exists later). Pick one and name the choice in the PR; do not let it default to empty.

**What stays untouched.** `plan-store-ref.ts`'s `config`, `listDir`, `readText`, `writeText` read the **working tree**, unchanged — they back a lifecycle write reading/writing the checkout it's about to act on, a different question from "what plans does the queue see," and the plan's Decisions section says explicitly to leave them alone. Do not fold them into the oid-keyed path.

**No verdict arithmetic in this stage.** The estate stage enumerates and reads; it computes no eligibility, no wait edges, no branch state. Those are later stages (`sliceVerdicts`, `waitVerdict`, `branch-state.ts` etc. already exist and are reused, not rebuilt). If you find yourself writing a rule here, it belongs in a rule file the walk composes later, not in this adapter.

### Done when

The plan's `## Done when` → **Estate** bullet is the specification:

> `pnpm --filter @plot-pm/domain exec vitest run corpus/plan-walk-estate.corpus.test.ts` passes: the stage's plan set and records equal `readEstatePlanMeta` and `readSliceNames` in `corpus/production.ts` on the pinned clone. Adapter tests prove the `plan-store-ref.ts` fixes.

That corpus test file does not exist yet (`packages/domain/corpus/` currently holds only `production.ts` plus the existing rule-level pairs named in the plan's Notes) — create it. In addition to the corpus comparison:

- A fixture proving the non-default `--prefixes` case (point 2 above) — same plan content, different configured prefix list, different parse result between an unflagged and a flagged call.
- A fixture proving the unreadable-ref case (point 3 above) does **not** silently answer empty.
- Mutation-test the oid-keyed fixture: if the new operation is changed to read by ref name instead of by oid, the fixture must fail. A test that passes identically whichever way the key is built is not proving the key.

Plus the repo's standing gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this touches `packages/domain/src/**` and `packages/domain/corpus/**`, which maps to `pnpm --filter @plot-pm/domain exec vitest related --run {changed}` and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` per the `Local checks` config. List no full suite beyond what the tool prints; `test:e2e` is CI's gate, not a local one.

`scripts/check-shell-lines.sh` is in scope only if this slice touches `.sh` under `skills/` — it should not, since the fix is adapter-side (`.ts`) and the parser's `--prefixes` flag already exists. If a shell change turns out to be needed, growth must be paid for by removing an equal number of shell lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` — it takes its title from the last commit subject rather than the plan's wave heading. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` → `### Estate` section.

### Scope guard

This branch owns:

- `packages/domain/src/adapters/plan-store/plan-store-ref.ts` and `plan-store-shell.ts` (the three fixes)
- `packages/domain/src/ports/plan-store.ts` (the new oid-parse operation's signature, and the branch-only-plans / index-read shape if it needs a new port method)
- `packages/domain/src/ports/refs.ts` only if the oid-parse operation needs a new `Refs` method beyond the existing `readBlobs`/`listBlobs` — check before adding one
- `packages/domain/corpus/plan-walk-estate.corpus.test.ts` (new)
- Whatever new rule/entity file holds the estate stage itself (there is no existing file for it — name it by what the plan calls the stage, e.g. `packages/domain/src/rules/plan-walk-estate.ts` or under `entities/`, consistent with how `scan-owner.ts` and `branch-state.ts` are organized)

No other branch is dispatched yet — this is the plan's root slice, so there is nothing else in flight to collide with. The next slice, `feature/the-walk-reads-the-branches`, waits on this one and will build on whatever shape this slice gives the estate reading.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
