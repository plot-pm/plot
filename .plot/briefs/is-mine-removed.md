## Implementation brief — mine-hides-rows-with-no-known (wave 4: isMine removal)

- **Plan (canonical):** docs/plans/2026-10-28-mine-hides-rows-with-no-known.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2812 merged
- **Branch:** `feature/is-mine-removed` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan review required since 2026-10-15T02:17:59Z)

This is the last wave. Slices 1–3 (#2823, #2829, #2849) are all merged on `main`. Nothing else in this plan waits on this branch.

### What to build

Remove `isMine` from `packages/domain/src/rules/ownership.ts` and its dedicated tests, now that the `mine` vs `mine-and-unknown` mode split (slice 3, #2849) has moved every production call site off it — except one, which this slice must resolve first.

**`isMine` is not yet dead code — check before deleting.** `git grep -n isMine` on `origin/main` as of this writing shows exactly one production caller left: `packages/board/src/app/lib/agent-rows/mine-filter.ts:272`, inside `ticketsForReader`:

```ts
export const ticketsForReader = <T extends Pick<IssueRow, 'assignees'>>(
  tickets: T[],
  reader: Reader,
  source: TicketSourceShape | null,
  mode: MineMode,
): T[] => (mode === 'all' ? tickets : tickets.filter((t) => isMine(ownedFromTicket(t, source), reader)));
```

Its own doc comment (`mine-filter.ts:257`) explains why: the panel decided *"the box wins"* for the ticket view (plan Decisions, item "Show every ticket in the mine mode") — this filter always uses the lenient rule, never `isMineStrict`, regardless of mode. Every other `isMine` call site in `mine-filter.ts`, `lanes-for-reader.ts` and `chip-row.ts` already reads `mode === 'mine' ? isMineStrict : isMine`; this one function deliberately never switches.

### The decision this slice must make — do not skip it

The plan's slice heading says "removes `isMine` ... once no production code calls it," which was the expectation at planning time but is not the state on `main` now. Re-verify with `git grep -n isMine` on a freshly fetched `origin/main` before touching anything — if a different slice merged in the meantime and changed this, trust the grep over this brief. As of #2849 merging, the fix is to give `ticketsForReader` its lenient answer without calling the exported `isMine`:

- The straightforward move is inlining `ownership(ownedFromTicket(t, source), reader) !== 'theirs'` at that one call site (the function already imports `ownership` or can import it alongside `ownedTicket`), and deleting the `isMine` import from `mine-filter.ts`.
- Do **not** invent a new exported alias for `ownership(...) !== 'theirs'` in the domain just to keep a one-line call site readable — that recreates `isMine` under a different name and defeats the point of this slice. An inline comparison with the existing doc comment explaining *why* it's lenient is enough; the comment already carries the reasoning.
- Leave `isMineStrict` alone. It has multiple live callers (`mine-filter.ts`, `lanes-for-reader.ts`, `chip-row.ts` tests) and is not in scope.

### Done when

The plan's `## Done when` list doesn't exist as a separate section here — this plan states its outcome in the Changelog and Decisions instead. Treat these as the specification:

- `isMine` no longer exists in `packages/domain/src/rules/ownership.ts`, and nothing in `packages/domain` or `packages/board` imports it. `git grep -n isMine` after the change should show zero production hits (test files that are deliberately kept for `isMineStrict` comparisons are fine; files asserting `isMine` itself must be removed or rewritten).
- `ticketsForReader` in `mine-filter.ts` still shows every open ticket under the lenient rule in both `mine-and-unknown` and `mine` modes — this is a behavior-preserving rename/inline, not a behavior change. The existing ticket-filter tests in `packages/board/test/unit/mine-filter.test.ts` (around line 118, which calls `isMine(ownedFromTicket(...))` directly to pin expected behavior) need rewriting to call `ownership(...) !== 'theirs'` or the equivalent inline expression instead, since the production import disappears.
- `packages/domain/test/ownership.test.ts` currently has ~20 assertions against `isMine` (lines 3, 29, 46, 52, 63, 69, 74, 160, 169, 176, 182, 209, 214-216, 276, 279-281, 349, 356, 399-415) plus a whole `describe('isMine keeps what it cannot classify', ...)` block and comparison assertions inside `describe('isMineStrict keeps only what it can classify as the reader's', ...)`. Removing `isMine` means removing or rewriting all of these — the `isMineStrict`-vs-`isMine` comparison tests (e.g. "agrees with isMine where ownership is mine", "disagrees with isMine where ownership is unknown") lose their point of comparison and should either be deleted (if `isMineStrict`'s own existing tests already cover the same cases) or rewritten to assert against `ownership(...)` directly.
- Every doc comment that references `{@link isMine}` across `lanes-for-reader.ts`, `chip-row.ts`, `mine-filter.ts`, and `ownership.test.ts`/`chip-row.test.ts`/`lanes-for-reader.test.ts` comments needs updating — a stale `{@link isMine}` pointing at a deleted export is worse than no link. `git grep -n '{@link isMine}'` and `git grep -n 'isMine'` (not `isMineStrict`) finds them all; there were roughly 15+ comment references as of this writing, mostly explaining the lenient-vs-strict distinction, which should now explain it in terms of `ownership(...) !== 'theirs'` vs `isMineStrict`.
- `packages/board/test/unit/a-row-is-owned-by-more-than-its-pr.test.ts:41-53` wraps the real `isMine` to record every row it's asked about — this needs to become a wrapper around whatever `ticketsForReader` now calls (`ownership`, most likely), or be restructured to spy on `ownership` directly.
- `pnpm --filter @plot-pm/domain exec vitest related --run` and `pnpm --filter @plot-pm/board exec vitest related --run` both pass on the changed files, and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` is clean — a removed export breaks any `.d.ts` consumer at compile time, not runtime, so TypeScript will find anything this list missed.

Plus: the repo's gates — no bundle diff in the PR, changeset declaring the domain package bump (this is at minimum a `patch` on `plot` — an internal rule removal with no behavior change — but confirm against semver guidance in CLAUDE.md if the ticket-filter rewrite changes any exported type), and `State:` line changes only via the controller scripts. For tests, name the local checks command: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` is not relevant here — this slice touches no `.sh` file.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is still moving
```

It reads the plan's `## Slices` heading ("isMine removal") for the PR title and body. After it's created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-28-mine-hides-rows-with-no-known.md:107`) in the same way slices 1–3 already recorded their PR numbers.

### Scope guard

This branch owns:
- `packages/domain/src/rules/ownership.ts` (removing `isMine`)
- `packages/domain/test/ownership.test.ts` (removing/rewriting `isMine`-only tests)
- `packages/board/src/app/lib/agent-rows/mine-filter.ts` (rewriting `ticketsForReader`'s one call site)
- `packages/board/test/unit/mine-filter.test.ts`, `packages/board/test/unit/a-row-is-owned-by-more-than-its-pr.test.ts` (updating the tests those production changes break)
- Doc-comment-only edits in `lanes-for-reader.ts` and `chip-row.ts` wherever they `{@link isMine}` — no behavior change there, just removing the dangling reference.

All three prior waves (slices 1–3, #2823/#2829/#2849) are merged — there is no other branch in flight on this plan to collide with. If you find any other production `isMine` caller this brief didn't name, or find that `ticketsForReader` is no longer the sole remaining caller, report it rather than improvising scope — the brief's premise depends on the grep above being current at the time you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
