## Implementation brief — a-pr-refresh-reads-the-history-once-a-day (slice 1: A delta keeps the store whole)

- **Plan (canonical):** `docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-delta-keeps-the-store-whole` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; issue #1087

Slice 1 of 3. `bug/the-full-read-asks-verdicts-of-open-prs-only` waits on this branch, because both change `refreshPrs` and `foldPrIndex`. `bug/a-host-timeout-names-no-login` is independent and touches only `plot-host.sh`'s failure kinds.

### What to build

The board makes its 43 s full PR listing (`pr-list --rich --state all --limit 1000`, measured 2026-10-01) on every second refresh. The cause is in the domain, not the host:

1. A full read writes `complete: true`.
2. The next refresh asks a delta (`prWindowFor` returns `{ since: watermark, complete: false }`, `packages/domain/src/rules/pr-index.ts:172`). `refreshPrs` computes `complete = window.complete && partialSaid === null` (`packages/board/src/server/fleet.ts:3007`), and `foldPrIndex` writes `complete: update.complete` (`pr-index.ts:104`). The store is now `complete: false`.
3. The next refresh finds `!held.complete` and asks a full read (`pr-index.ts:164`).

The delta itself answered 0 rows in 0.8 s. Nothing is wrong with it; the fold forgets that a delta over a whole store leaves the store whole.

Build, in this order:

- **`PrIndexUpdate.kind`** — `'whole' | 'delta' | 'partial'` replaces `complete: boolean` on the update. `PrWindow.complete` becomes `PrWindow.kind`.
- **`answerKind(window, partialSaid)`** — one exported arrow in `rules/pr-index.ts`. `fleet.ts:3007` calls it and stops doing the arithmetic.
- **`foldPrIndex`** replaces on `whole`, merges on `delta` and `partial`, keeps `complete: true` for a `delta` over a whole store, writes `complete: false` for `partial`, and leaves a partial store partial under a `delta`.
- **`PrIndex.wholeAt`** — this machine's clock at the last `whole` fold. `prWindowFor` measures the 24 h `PR_FULL_READ_MS` (`fleet.ts:311`) against `wholeAt`, never against `at`. A store with no `wholeAt` reads as due.
- **`PR_INDEX_VERSION` 3** in `packages/domain/src/entities/pr-index.ts` (now 2, line 12).
- **The failed-full-read fallback** — see below.
- **Two stale comments corrected**: `skills/plot/scripts/plot-host.sh:89-99` (*"BITBUCKET'S BULK LISTING CANNOT"* narrow) and `fleet.ts:233-238` (*"`bb pr list` has no query flag, so its bulk listing is asked in full"*). `bb_window_listing` (`plot-host.sh:933`, called at `:3978`) does narrow, since `f0a18f53`.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**`complete` stays on the store; the UPDATE carries a kind.** The flag carried two meanings: *the last answer covered every state* (what a Bitbucket partial lacks) and *the store holds every PR up to its watermark* (still true after a healthy delta). Splitting the update into three kinds is the fix. Do not add a second boolean beside `complete` — a `delta` and a `partial` are both "not a full read", and two booleans let a caller write the fourth combination nobody defined. Vendor words stay out of the domain: it sees *whole*, *delta*, *partial*.

**The domain decides the kind; the controller does not.** Today `fleet.ts:3007` holds the rule in an expression. After this slice it holds a call to `answerKind`. That is the layering rule (controller → domain), and it is what makes the three kinds unit-testable without a fixture host.

**`at` cannot be the full-read clock.** Every delta rewrites `at` (`pr-store.test.ts:493` pins that). Once a delta keeps the store whole, `at` would never age past 24 h on a healthy board, so the daily full read — the only thing that sees a deleted PR — would never run. Hence `wholeAt`. Do not reuse `watermark` either: it is the host's clock, not this machine's (`pr-index.test.ts:365` already argues this for `at`).

**The served maps stay keyed on the answer kind, not on the folded store's flag.** `fleet.ts:3039` serves this pass's rows as the whole map when `complete` is true. After this slice a delta fold over a whole store also reads `complete: true`. A controller reading the FOLDED store's flag would serve a 0-row window as the whole map and report ~1000 branches as having no PR — #912's shape. So `:3039` tests `kind === 'whole'`. `pr-store.test.ts:442` (*a delta whose window returns 3 rows still serves 933*) must stay green **unchanged**; editing it to pass is the forbidden move.

**The version bump costs exactly one full read, and every reader is named.** A version-2 store decodes as `null`, which is today's behaviour for an unrecognised version. Change in this branch's commits:

- fixtures writing `v: 2`: `test/reconcile/impl-status-index.test.mjs:313`, `test/reconcile/scan-index.test.mjs:279`, `packages/board/test/unit/registryd-main.test.ts:1268`
- `packages/domain/test/pr-index.test.ts:249` (pins version 2)
- the two bundles embedding `decodePrIndex`: `skills/plot/scripts/board/plot-pr-index-lookup.mjs` and `skills/plot/scripts/board/board-server.mjs` — rebuild with `pnpm build:board`; never hand-edit
- grep for `PR_INDEX_VERSION` and `v: 2` once more before pushing; the list above was measured on 2026-10-01

**A failed full read falls back to a delta for one hour.** A 504 is no rate limit, so `hostReaction` returns `null` (the catch at `fleet.ts:~3078`), the next refresh follows in `PR_REFRESH_MS` (60 s), and the full read is still due — the heaviest query would repeat every minute. Record the failure time **in memory on the `CacheEntry`**, not in the store: it is this process's observation, and a store field would be inherited by a process that never saw the failure. `prWindowFor` takes it as a **reading** (the domain takes readings as values; it imports no port and awaits nothing). The rule: where the store is whole, carries a watermark, and the full read is due **only by age**, a full read that failed less than 1 h ago answers a delta. One hour after the failure, a full read again. A cold store, a partial store and a store with no watermark have nothing to fall back to and keep today's cadence.

**No immediate retry.** A retry doubles the cost of a request that already ran too long. That is the plan's explicit rejection; do not add one.

**Out of scope here:** the `--rich-open` split (slice 2), the `timeout` failure kind (slice 3), `PR_LIMIT` (#333), and the delta's window rule (`09cf9018`, unchanged).

**Invariants carried over unchanged:**

- **The index never says no.** A missing, wrong-version or unparseable store means *ask the host*, never *no PRs*. The version bump relies on this.
- **One writer.** `fleet.ts` remains the only caller of `foldPrIndex`; `plot-pr-index-lookup.mjs` reads and never writes.
- **The store is written on the success path only.** The `allUnknown` path and the `catch` leave the file alone — the fallback timestamp lives on the entry for this reason.
- **Domain style:** arrow functions, TSDoc that states what an export does and how it fails. The reasoning goes in the commit message, not in a 100-line comment.

### Done when

The plan's `## Done when` and slice 1's `Tests:` list are the specification. The assertions that a naive implementation passes without:

- **Three refreshes over one fixture host send one full call and two `--since` calls** (`pr-store.test.ts`). This is the bug's own shape; a fold test alone passes while the controller still computes `complete` itself.
- **A new case serves 1000 PRs after a 0-row delta over a whole store.** Catches a `:3039` that reads the folded store's `complete`.
- **`:442` green unchanged.** Same catch, from the 3-row side.
- **`:535` ages `wholeAt`, not `at`.** A test that ages `at` passes with the old clock still in place.
- **A version-2 store on disk costs exactly one full read** — not zero (served stale) and not two.
- **A fixture host answering a due full read with `HTTP 504` gets a `--since` call on the next refresh and the full call again one hour later.** Both halves: a fallback with no expiry never sees a deleted PR again.
- **`pr-index.test.ts`**: `delta` over whole stays whole and advances the watermark; `partial` over whole is not whole; `delta` over partial stays partial; due 24 h after `wholeAt` while `at` is newer; no `wholeAt` reads as due; `answerKind` for each window × partial sentence; the 1 h fallback both ways. `:350` (*a delta is never complete*), `:365` (*against `at`*) and `:249` (version 2) are **rewritten to the new rule in the same commit** — they pin the defect.
- **`pr-store.test.ts:474` and `:558`** are rewritten to the new rule; they pin step 2 and step 3 of the alternation.
- **`test/reconcile/host.test.mjs`**: a stubbed `bb` with `--since` answers all three states through `bb_window_listing` with no partial sentence, and the board folds it as `delta`.
- **The PR body shows the call sequence of three real refreshes from a running board's log**, before and after (plan Open Point 2 — the alternation was derived from code, never observed).

Plus the repo's gates, on Node 24 (`nvm use`):

- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`
- the domain package: `pnpm --filter @plot-pm/domain typecheck`, `pnpm --filter @plot-pm/domain test:coverage` (the coverage gate)
- `pnpm build:board` and commit both rebuilt bundles; CI's no-diff gate fails a stale one
- a changeset: description first, `bumps:` block last, `plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md` in the block. Package `@plot-pm/board` for the board and domain change; `'plot': patch` with a `plot` skill bump if the `plot-host.sh` comment change is to be released as a skill change. Run `./scripts/check-changeset-packages.sh`.
- do **not** run `pnpm run test:e2e` locally; CI owns it

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` inside this slice's heading in the plan's `## Slices` — the form is `(Branch: bug/a-delta-keeps-the-store-whole, PR: #N)`; a trailing `→ #N` does not parse for a heading-annotated slice.
- Name `Issue: #1087` in the PR body. Do not close #1087: slices 2 and 3 remain.

### Scope guard

This branch owns:

- `packages/domain/src/entities/pr-index.ts`, `packages/domain/src/rules/pr-index.ts`, `packages/domain/test/pr-index.test.ts`
- `packages/board/src/server/fleet.ts` — `refreshPrs` (`:2790`), its catch, `CacheEntry` for the failure time, and the comment at `:233-238`
- `packages/board/test/unit/pr-store.test.ts`, `packages/board/test/unit/registryd-main.test.ts:1268`
- `test/reconcile/impl-status-index.test.mjs`, `test/reconcile/scan-index.test.mjs`, `test/reconcile/host.test.mjs` (the `bb` delta case only)
- `skills/plot/scripts/plot-host.sh:89-99` — the comment only; no behaviour
- the rebuilt bundles under `skills/plot/scripts/board/`

In flight, verified 2026-10-02 against every remote branch's diff from its merge base:

- `bug/the-merge-subject-is-one-rule` changes `packages/domain/src/entities/fleet.ts` and the bundle `plot-pr-index-lookup.mjs`. The bundle will conflict. It is generated: take either side, run `pnpm build:board`, commit the result.
- `bug/the-full-read-asks-verdicts-of-open-prs-only` and `bug/a-host-timeout-names-no-login` have no ref yet. Slice 3 will touch `plot-host.sh` near `:474-564`; this branch touches only `:89-99`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
