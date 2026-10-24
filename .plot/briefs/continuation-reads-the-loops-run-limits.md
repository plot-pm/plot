## Implementation brief — a-desk-continuation-skips-its-run (wave: Continuation, 1 of 2)

- **Plan (canonical):** docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Branch:** `bug/continuation-reads-the-loops-run-limits` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This branch is the first of two in the Continuation wave. `bug/a-failed-continuation-leaves-the-desk-as-found` (slice 2) waits on it — the plan's own annotation says both slices edit `continueOnDesk` in `packages/fleet/src/shared/continuation.ts`, so land this one first and push early so slice 2 rebases onto a settled `continueOnDesk`, not the reverse.

### What to build

Three parsing/accounting defects in how `continueOnDesk` (`packages/fleet/src/shared/continuation.ts`) reads `Slice max runs` and `Slice max spend`, found by plot-review against 16 merged PRs and checked at `84b1638e4` on 2026-10-24 (issue #2475):

1. **`continuation.ts`'s own `positiveOr` (line 566) accepts more than the worker loop's `positive`/`count` do.** The loop (`worker-loop.ts:1930-1937`) reads a run-limit config value through `/^\d+$/` — digits only. `continuation.ts`'s `positiveOr` reads the same kind of value through bare `Number()`, which also accepts `1e1`, `0x5`, and other numeric-literal forms the loop's regex rejects. The two must agree on what `Slice max runs` means, or a value the loop would refuse to read (falling back to `DEFAULT_SLICE_MAX_RUNS`) the continuation path accepts as a real number — a silent split between how a fresh dispatch and a continuation enforce the same config key.

2. **An unreadable `Slice max spend` is read as "no limit" instead of refusing.** `continuation.ts`'s `dollarsOr` (line 576) takes a `fallback: number | null` and returns it whenever the regex doesn't match — so a present-but-malformed value (e.g. `Slice max spend: abc`, or `0`, or a negative number) is silently treated the same as the key being absent (`null` → no limit enforced). The worker loop's own reading, `dollarsOrUnset` (`worker-loop.ts:1959-1964`), has a three-way `DollarsReading` type specifically so a present-and-unreadable value is distinguishable from an absent one — and its caller (`worker-loop.ts:2385-2388`, the `LOOP_CONFIG_KEYS` validation) refuses the start rather than running with no limit. `continuation.ts:805-811`'s call site needs the same distinction: a malformed `Slice max spend` must refuse the continuation, not silently grant it unlimited spend.

3. **The `write` path's manifest carries no `sliceRuns`, so `Slice max runs` never fires on it.** `continueTarget`'s `write` outcome (`continue-target.ts:153-159` — the fallback for a desk whose manifest is `unnamed` but whose ending record says it's waiting on this exact branch) is read as `target.manifest === 'write'` at `continuation.ts:910-925`, which calls `writeDeskManifest` with no `sliceRuns` field. Every later call to `sliceRunsFromManifest` (`continuation.ts:552-563`) on that manifest reads `0` — not because no runs happened, but because the record was never carried forward. `continuation.ts:800` (`const runs = sliceRunsFromManifest(manifestBeforeStop, branch)`) only runs for the `stamp` path (`manifestBeforeStop` is `null` whenever `target.manifest === 'write'`, since there is no previous manifest to read), so a `write`-path continuation never counts against `Slice max runs` at all — it is an unlimited-runs path hiding inside a loop that is supposed to cap every run at the same number.

### Decisions this plan settles — do not re-derive them

**Whether to share one parser module or keep a declared, corpus-tested duplicate is still open — the plan does not settle it, and neither does this brief.** The plan's own Open Questions list this as unresolved: *"Does slice 1 share one parser module between `packages/fleet/src/shared/continuation.ts` and `worker-loop.ts`, or keep the declared duplicate plus a corpus test?"* Both callers are TypeScript, which *The Layering Rule* and the duplicate rule in `CLAUDE.md` say favours a shared domain function — but `sliceRunsFromManifest` and `dollarsOr` are already explicitly documented as "duplicated... for the reason {@link sliceRunsFromManifest} gives" (no module under `shared/` imports an entry module under `server/entry/`). Read that constraint before choosing: a shared function needs a home in `packages/domain` (or another module neither `shared/` nor `server/entry/` is forbidden from importing), not a reach from one file into the other. If you keep the duplicate, the plan requires *A Shell Script Asks The Domain*'s declared-duplicate contract: a corpus test pinning `continuation.ts`'s parse against the loop's, named and justified per `docs/shell-and-domain.md`.

**The run-limit and spend-limit refusals already run before the stop and before any write (`continuation.ts:794-811`) — that ordering is correct and is not this slice's defect.** The plan's Changelog line names a different, already-fixed-elsewhere concern ("refuses on every path... before `beforeStart`") — that is slice 2's `bug/a-failed-continuation-leaves-the-desk-as-found`, about the registry-tick `beforeStart` ordering, not this slice's parser/manifest accounting. Don't move the refusal checks in this slice; only fix what they read.

**`DEFAULT_SLICE_MAX_RUNS` (`run-limit.ts`, value 12) stays the fallback for an absent `Slice max runs` — only a malformed-but-present value changes behaviour.** Don't make an absent key refuse; `positive`/`count` in the loop and `positiveOr` here both already treat absence as "use the default," and that is correct per `run-limit.ts`'s own doc comment. The fix is narrowing what counts as a *parseable* present value, not changing what happens when the key is missing.

**Rules carried over unchanged, worth restating because a misread here hides a desk running past its budget:** absent is not the same as unreadable — `dollarsOrUnset`'s three-way `DollarsReading` (`unset` / `value` / `unreadable`) is the shape to match, not collapse back into a two-way nullable fallback.

### Done when

The plan's `## Changelog` line for this wave: *"A desk continuation refuses at `Slice max runs` and `Slice max spend` on every path..."* — this slice's share of that is the **parsing and counting**, which must no longer silently diverge from the worker loop's own reading. Concretely:

- `continuation.ts`'s run-limit parsing rejects the numeric-literal forms (`1e1`, `0x5`, etc.) that `worker-loop.ts`'s `/^\d+$/`-based `positive`/`count` already reject, falling back to `DEFAULT_SLICE_MAX_RUNS` the same way the loop does. A test proves a value the loop would reject is also rejected here (ideally the corpus test named above, if you choose the declared-duplicate path).
- A malformed/non-positive `Slice max spend` (not absent — present and unreadable) refuses the continuation rather than granting an unlimited spend. A test proves a continuation attempted against a malformed `Slice max spend` is refused, and a separate test proves an *absent* `Slice max spend` is still unlimited (no regression on the common case).
- A `write`-path continuation (the `continueTarget` fallback for an `unnamed` manifest with a matching `blocked`/`holding-work` ending) carries forward a `sliceRuns` count rather than starting a silent, unlimited count at every write. Decide and test what it carries forward from: the ending record names no run count today, so this may mean reading the branch's run history from elsewhere, or deliberately seeding `sliceRuns: { branch, runs: 1 }` to count the write-path start itself as run 1 rather than run 0 forever. Whichever you choose, add a test that drives two consecutive `write`-path continuations on the same branch past `Slice max runs` and asserts the second one refuses.

Plus: the repo's standing gates — no `State:` line hand-edited (none should be touched by this slice), and the purity/layering gates if the parser is extracted into `packages/domain` (no import beyond `zod` outside `adapters/`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests, related-package vitest, and typecheck for the files this branch actually touches (this slice's files sit under `packages/fleet/src/shared/`, `packages/fleet/src/server/entry/worker-loop.ts`, and possibly `packages/domain/src/rules/`). The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR — don't run them locally as a matter of course; a failure there comes back as a correction.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the wave heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/continuation-reads-the-loops-run-limits` line under `### Continuation`).

### Scope guard

**This branch owns:** `packages/fleet/src/shared/continuation.ts` (the `positiveOr`/`dollarsOr`/`sliceRunsFromManifest` functions and their call sites in `continueOnDesk`), and — only if you choose to extract a shared parser — a new module under `packages/domain/src/rules/` plus its corpus test under `packages/domain/corpus/`. Read, not edited unless extracting: `packages/fleet/src/server/entry/worker-loop.ts`'s `positive`, `count`, `dollarsOrUnset` (lines 1930-1968) and `sliceRunsOf`/`raiseSliceRuns` (lines 454-483) — these are the reference behaviour this slice must match, not files this slice redesigns. Also read: `packages/domain/src/rules/continue-target.ts` (the `write` outcome this slice's finding #3 responds to) and `run-limit.ts` (`runLimitRefusal`, `DEFAULT_SLICE_MAX_RUNS`) — neither needs edits unless the manifest-shape fix for finding #3 changes what a caller passes in.

**Siblings in flight, verified at brief-writing time (2026-10-24):** none. This is the first branch of the plan to start — no other slice (`bug/a-failed-continuation-leaves-the-desk-as-found`, `bug/drop-reads-the-boards-branch`, `bug/mergeability-uses-the-prs-own-base`, `bug/continuation-tests-assert-their-names`) has a remote ref yet. Slice 2 (`bug/a-failed-continuation-leaves-the-desk-as-found`) is declared to wait on this one and will rebase onto whatever shape `continueOnDesk` has after this branch merges — leave clear commit boundaries so that rebase is easy to follow.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
