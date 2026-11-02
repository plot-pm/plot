## Implementation brief — the-board-starts-processes-on-the (wave: Held git reads)

- **Plan (canonical):** [docs/plans/2026-11-01-the-board-starts-processes-on-the.md](../../docs/plans/2026-11-01-the-board-starts-processes-on-the.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3018 merged
- **Branch:** `feature/the-board-reads-git-through-cached-refs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review on `main`)

Waits on `feature/a-board-request-counts-its-processes` (#3020, merged — the ratchet test exists and records today's warm-request process list). Runs beside `feature/the-board-holds-its-config`, which touches no file this slice touches. `feature/the-board-parses-a-plan-once-per-blob` waits on this slice, because it builds on the `WalkCache` this slice adds to the board.

### What to build

The board re-reads several git answers from scratch on every `/api/board` request even though they depend only on object ids that do not move within the request: the Delivered record (`refs.recordCommit`, about four process starts per Delivered plan — 17 of 626 plans today, ~68 sequential starts), plan authorship (`git log --diff-filter=AR --name-status`), the behind count (`git symbolic-ref` + `git rev-list --count`), and the default branch (`git symbolic-ref` / `origin/HEAD`). `cachedRefs` (`packages/domain/src/workflows/plan-walk-cache.ts:230`) already wraps `listBlobs`, `readBlobs`, `mergeSubjects` and others this same way, keyed by the oids in the beat's `RefSnapshot` — this slice extends the same wrapper with four more keyed operations so these four reads join the pattern instead of starting fresh every request.

### The decisions the plan settles — do not re-derive them

**Key by oid, never by ref name — this is the wrapper's existing invariant, not a new rule.** `cachedRefs`'s doc comment at `plan-walk-cache.ts:213` is explicit: "EVERY KEY NAMES AN OBJECT, AND THE READ IS MADE BY THAT OBJECT." The `keyed()` helper (`:245-260`) already does this: it resolves a ref to an oid through `snapshot.oidOf`, builds the cache key from oids plus an `extra` discriminator, and falls through to `inner` uncached when any oid is `undefined`. Follow that shape exactly — do not add a second keying mechanism for these four operations.

**`Refs.recordCommit` needs a `ref` parameter; it does not have one today.** Verified: `ports/refs.ts:406` is `recordCommit(file: string, field: string): Promise<PortResult<string | null>>` — no ref argument. `refs-git.ts:640-655` calls its own `defaultBranch()` internally on every invocation (`const main = await defaultBranch()` at `:641`), which is itself three process starts (`refs-git.ts:438-444`). The one caller, `board.ts:2330` (`refs.recordCommit(rel, 'Delivered')`), and the fixture at `refs-fixture.ts:365` both change when the signature gains the parameter. Keep `recordCommitOf` (the pure stdout parser at `refs-git.ts:316`) untouched — only the port method's signature and its one adapter implementation change.

**Four new `WalkCache` kinds, not a second cache.** `WalkCache` already lists `trees`, `blobs`, `parses`, `contains`, `merges`, `additions`, `ranges`, `changed`, `conflicts` (`plan-walk-cache.ts:88-106`), each an `OidCache` with its own key shape documented in a one-line comment above the field. Add four more fields the same way — one each for `recordCommit`, `planAuthors`, `countBehind` and `defaultBranch` — in `freshWalkCache()`'s `kinds` object (`:125-135`) so `size()`, `begin()` and `sweep()` cover them for free (they iterate `Object.values(kinds)`, not a hardcoded list). The plan's Design section 4 names the exact key shapes: `recordCommit` by (`origin/<default>` oid, file, field); `planAuthors` by (`origin/<default>` oid, directory) — already precedented by `additions`, which is keyed the same way; `countBehind` by (HEAD oid, attached-or-detached, `origin/<default>` oid); `defaultBranch` by the snapshot digest (`RefSnapshot.digest`, `:163`) — the one kind with no oid pair, because the answer depends on the whole snapshot's `Main branch` resolution, not on any single ref's oid.

**The board wraps `refsFor(opts)` once per `cacheKey(opts)`, over the snapshot `refsToken` already reads.** `fleet-state.ts:139` calls `refState('both')` once per request today (`refsToken`) — this read stays exactly as-is; it is not one of the four reads this slice adds and not itself newly cached (it has no oid to key by; it IS the snapshot). `buildBoard` is the one place that should call `cachedRefs(inner, snapshot, cache)` and then call `cache.begin()` / `cache.sweep()` once per completed build — match the existing per-build lifecycle `cachedPlans` uses rather than inventing a second one. The cache instance is held per `cacheKey(opts)`, the same key the board already uses to scope other per-estate state, so two different board configurations (e.g. two repos under one process) never share a cache.

**`defaultBranchOf`'s resolution order does not change, only where it is read from.** `board.ts:1016`'s order — `Main branch` config value when set, else `origin/HEAD` — is the order every cached call must agree on. Read it once per request through the new `defaultBranch` cache kind, and have `planEstate`, `planMetasAtDefault`'s key, `measureBehind` and the Delivered loop all resolve the default branch through that one cached call rather than each re-deriving it. A config `Main branch: trunk` with `origin/HEAD → main` must make every one of those four read `origin/trunk` — this is a `Done when` row, not incidental.

**`hashFilesSync` (the bundle hash) is a different mechanism, held per bundle stat — not an oid-keyed `WalkCache` entry.** It has no commit oid to key by; its staleness check is the bundle file's own `(mtimeMs, size, ino)`, the same stamp shape `the-board-holds-its-config`'s config decorator uses for `CLAUDE.md`/`AGENTS.md`. Keep this as a small separate decorator near `spawnContractReadingFor` (`board.ts:353`) — folding it into `WalkCache` would give it a key shape (an oid) it does not have an answer for.

**A failed read is never stored — this applies to all four new kinds, matching every existing `keyed()` call.** `keyed()` only calls `store.set` when `fresh.ok` is true (`:257-258`); a failed `recordCommit`, `planAuthors`, `countBehind` or `defaultBranch` must leave the cache untouched so the next request asks again rather than caching a failure.

**Ancestry trust does not apply here.** The "ANCESTRY IS TRUSTED FROM THE CACHE ONLY WHILE GIT CAN SEE ALL HISTORY" guard (`:220-223`, `canTrustAncestry`) protects `contains`/`containsMany` specifically, because a shallow clone or `refs/replace` can make ancestry answers wrong. None of this slice's four reads ask about ancestry, so none needs that guard — do not add it defensively.

### Done when

The plan's `## Done when` table names the Held-git-reads rows precisely — implement to those, not a paraphrase:

- A Delivered record is read once per oid: counting wrapper over `refsFixture`, two builds at one `origin/main` oid read it N times once, 0 times on the unchanged second build, N times again after the oid moves (`packages/domain/test/plan-walk-cache.test.ts`).
- `recordCommit` reads at the oid it is given, even when `origin/main` moves between the read and the log running — a git-sandbox test, not a fixture test, because this is exactly the race the port-level key exists to close (`packages/domain/test/refs-git-reads.test.ts`).
- A behind count follows HEAD: one origin oid, then HEAD reset, then HEAD detached — each re-asked (`plan-walk-cache.test.ts`).
- A failed git read is not held: inner `recordCommit` fails once, then succeeds — the next build asks again rather than replaying the failure (`plan-walk-cache.test.ts`).
- A full (uncached) walk and a cached walk agree on all four new operations, over a corpus estate (`packages/domain/corpus/plan-walk-cache.corpus.test.ts`) — this is the declared-duplicate pairing this repo's domain/shell contract requires wherever two implementations could drift; verify there is in fact a shell-side duplicate to pair against before assuming this corpus file is new rather than extended.
- The default branch follows `Main branch`: config set to `trunk`, `origin/HEAD → main` — every cached read in the request uses `origin/trunk` (`packages/board/test/unit/board-request-starts.test.ts`).
- The ratchet's warm-request list loses `recordCommit`'s `git log -G`, the `--diff-filter=AR` log, `rev-list --count`, `symbolic-ref`, `rev-parse`, `git show` (draft plan reads) and `hash-object` lines — assert the exact remaining list, not merely "fewer than before" (`board-request-starts.test.ts`, the same ratchet file the Proof slice built).

Plus: the repo's gates — no committed `board-server.mjs` diff, a changeset naming `plot` or `@plot-pm/board`, and the domain package's arrow-function and TSDoc conventions for every new/touched export in `packages/domain/src/`. For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps `packages/domain/**` and `packages/board/**` changes to their suites and typechecks. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows past its merge base. This slice is TypeScript-only (`ports/refs.ts`, `refs-git.ts`, `refs-fixture.ts`, `plan-walk-cache.ts`, `board.ts` and the four callers) — it should touch no `.sh` file, so the gate should not fire. If a change here does end up touching shell, that growth is paid for in the same change.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch shows activity.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/the-board-reads-git-through-cached-refs` under `### Held git reads`).

### Scope guard

This branch owns: `Refs.recordCommit(file, field, ref)` in `ports/refs.ts`, `refs-git.ts` and `refs-fixture.ts`, and its four callers (`board.ts:2330`, plus `entry/design.ts:170`, `entry/verify.ts:400`, `auto-design.ts:473` per the plan's Design section 4 — verify these call sites still read as the plan describes before changing them); the four new `WalkCache` kinds and their `cachedRefs` wrapper operations in `plan-walk-cache.ts`; the board's one `WalkCache` per `cacheKey(opts)` with `begin`/`sweep` per build; `planEstate`, `planMetasAtDefault`'s key, `measureBehind`, the Delivered loop and `draftPlanFiles` reading through the cached wrapper; the `hashFilesSync` per-bundle-stat decorator near `spawnContractReadingFor`; and the ratchet list's git-read lines going.

It does not own: the config decorator or any of the four config-reading routes (`feature/the-board-holds-its-config`, a sibling slice touching disjoint files — `packages/domain/src/adapters/scripts/`, `config-reader.ts`, `server-info.ts` — coordinate rather than resolve unilaterally if both slices end up touching `board.ts`'s `BuildBoardOptions`); the `cachedPlans`/`PlanMeta` kind, `ticketLaneData` running once per request, or `planMetaCaches` going away (`feature/the-board-parses-a-plan-once-per-blob`, which explicitly waits on this slice and builds on the `WalkCache` instance this slice creates on the board — do not pre-build its `parses`-kind integration here); the ratchet test itself and `boardAnswer` (`feature/a-board-request-counts-its-processes`, already merged as #3020 — read its warm-request list as the starting point this slice's `Done when` rows subtract from, not as something to recreate).

`fleet.ts` changed in 24 commits in one week per the plan's Notes — rebase onto `origin/main` before review rather than assuming the file is as last read.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
