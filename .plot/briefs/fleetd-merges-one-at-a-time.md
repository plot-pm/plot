## Implementation brief — fleetd-merges-slice-prs-one-at (wave: One merge per pass)

- **Plan (canonical):** [docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md](../docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2914 merged
- **Branch:** `feature/fleetd-merges-one-at-a-time` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` via the normal slice-PR path (this branch's own PR goes through the same review the fleet will later run on everyone else's)

This is the plan's second and last slice. The first slice, `feature/merge-waits-for-a-settled-main`, is merged (#2931) — `mergeAt`/`merge()` already live in `packages/domain/src/workflows/merge.ts` with `default-branch-unsettled`, `review-not-passed` and `requireReading` all built. This slice's `<!-- waits: feature/fleetd-reviews-slice-prs -->` is also cleared: all five slices of the sibling plan #2900 are merged, most recently #2958, which built `rules/slice-pr-next.ts` and `packages/fleet/src/shared/auto-review.ts`.

### What to build

fleetd today merges nothing — every merge happens through a person running `plot-ask.mjs merge` by hand, so delivery stops when that session ends. This slice gives fleetd its own merge arm, wired into the daemon's automatic-writes loop, so an open slice PR with a passed review gets merged without a person driving it.

Two files carry the real work:

1. **`packages/domain/src/rules/slice-pr-next.ts`** — replace the `mergeArm` stub (currently `readings.repair?.read === 'unread' ? hold('unread') : none('merge-not-built')`, line 215-216) with the real predicate from the plan's table (Design → Approach, slice 2). Add a `nextMerge` rule beside it that picks exactly one PR to merge per pass.
2. **A new fleet-layer tick**, shaped like `packages/fleet/src/shared/auto-review.ts`'s `reviewTick` (which has zero callers today — this slice is likely the first thing in the repo that wires a `slicePrNext`-driven tick into the daemon at all). It loops the scope's open rows, calls `slicePrNext`, and for a PR whose step resolves to `merge` through `nextMerge`, calls the already-built `mergeAt` from `packages/domain/src/workflows/merge.ts`.

Wire that tick into `packages/fleet/src/shared/auto-writes.ts`'s `fleetAutoWrites`, which composes the daemon's automatic writes (`maybeAutoDispatch` → `runAutoDeliverPass` → `runAutoProgressPass` → `runAutoVerifyPass` → `runAutoDesignPass`). Add the merge tick as one more step in that same try/catch sequence.

### The decisions the plan settles — do not re-derive them

**The merge arm's predicate is narrow by design: `row.plotReview === 'success' && row.plotReviewSha === row.headSha`.** Nothing else about the PR matters to this arm — not CI, not mergeability by itself (that's a separate hold, see below), not who authored it. A ticketed HIGH that #2903's `write-status` step marked `ticket-accepted` also lands as `plotReview: 'success'`, so it merges through this one row with no second code path. A row with no `plotReview` field at all (never asked) answers `none`, never a hold — the index never says no (CLAUDE.md's "A Decision Reads The Index" section is binding here, not just background).

**The hold table, verbatim from the plan — implement exactly these six, no more:**

| Reading | Next step |
|---|---|
| `row.plotReview === 'success'` and `row.plotReviewSha === row.headSha` | `{ step: 'merge', head }` |
| `defaultBranch` settled red within `Checks wait` | hold `default-branch-red` |
| `defaultBranch` older than `Checks wait`, red or green | hold `default-branch-stale` |
| `defaultBranch` is `null` | hold `default-branch-unread` |
| `defaultBranch.settled.sha` differs from its `headSha`, or `newestMerged.mergedAt` is later than `defaultBranch.askedAt` | hold `merge-in-flight` |
| `row.mergeable === 'CONFLICTING'` | hold `conflicting` |

**Do not call `defaultBranchRed` for the stale check — write the merge arm's own age comparison.** `rules/default-branch.ts`'s `defaultBranchRed(reading, now, checksWaitMs)` is the *dispatch/queue* hold, and it is documented there as lifting on a stale reading (a stale red reads as "not red," so a queued slice stops waiting). The merge path needs the opposite bias: a merge cannot be undone, so an old reading — red or green — must hold rather than lift. Reuse the same age arithmetic (`defaultBranchAgeMs`, `checksWaitMsOf`), but gate the merge arm on it directly rather than through `defaultBranchRed`. The plan names a test for exactly this: one fixture where `defaultBranchRed` answers `false` (not red — stale lifts it) and the merge arm still holds `default-branch-stale` on the same fixture. If your implementation makes that test agree, the stale arm is wrong.

**`merge-in-flight` is read from the index, not from a fresh host call.** `newestMerged` (a `{ mergedAt: string } | null`) is already part of `SlicePrNextReadings` — it's the newest MERGED row of the PR index, passed in by the tick. A MERGED row is terminal (CLAUDE.md: "the index can supply `pr: 'MERGED'` but not `pr: 'none'`"), so reading it here is sanctioned. This hold exists because of a measured lag: fleetd's own `.plot/state/default-branch.json` reading is refreshed only on the PR beat (every twelfth scan beat — `packages/fleet/src/shared/fleet-clock.ts`), while automatic writes (where a merge runs) happen on every scan beat. About eleven scans after a merge, the reading still looks settled-green on the pre-merge head, which would otherwise let the next PR merge into a window the first merge hasn't actually closed yet. The controller's own fresh `Refs.remoteSha` tip read (built in slice 1, inside `merge()` itself) is the final guard at the destructive step; this hold is the earlier, cheaper one that stops the tick from even trying.

**At most one merge per pass — `nextMerge` picks the lowest PR number among the rows that answer `merge`.** Write it as a small pure function over the tick's per-row `slicePrNext` answers, not as a side effect inside the loop. The tick calls `mergeAt` for that one PR only; every other `merge`-eligible row waits for the next pass, by which point the tip (and therefore every row's `defaultBranch`/`newestMerged` reading) has moved.

**The tick calls the already-built domain `mergeAt` in process — it does not re-decide anything `merge()` already decides.** `mergeAt`/`merge()` (slice 1, `packages/domain/src/workflows/merge.ts`) already refuse `default-branch-unsettled`, `review-not-passed`, `head-moved`, draft, release-pr, checks-not-green/-unbound, and (per D1, built by #2898) any unattended caller. The merge arm and `nextMerge` are a *candidate selection* layer in front of that controller — they decide which PR to attempt, not whether the attempt succeeds. A `head-moved` refusal from `mergeAt` just means: wait for the new head's review to come back through the normal review tick; do not add retry logic for it here.

**No retry of a `host-refused` merge at the same head — keep this in memory only, mirroring the existing pattern in `auto-writes.ts`.** `fleetAutoWrites`'s closure already keeps `briefsAsked`, `briefWaits`, `deliverHeldLogged`, `deliverCarried`, `progressSent` as `Set`/`Map` values that live for the daemon's process lifetime and are explicitly *not* persisted to disk (see the comments at `auto-writes.ts:37-47`: "IN MEMORY, FOR THE DAEMON'S LIFE: a restart loses it... the next pass asks again"). Add one more such value — a `Map<pr, headSha>` or similar — recording the PR/head of the last `host-refused` outcome from `mergeAt`, and skip re-attempting that exact (PR, head) pair until the head moves. A fleetd restart loses the memory and asks once more; this is the explicitly intended behavior, not a gap to close.

**The merge tick only ever runs on the daemon's loop, never under `--once` — and this needs no extra guard.** `registryd-main.ts` sets `scanClock = args.once ? null : startFleetClock(...)`. Under `--once`, the *entire* scan clock — including the PR beat and `fleetAutoWrites` itself — is skipped. Because this slice's integration point is inside `fleetAutoWrites`, wiring the merge tick there automatically satisfies "merges nothing under `--once`" with zero additional conditionals. Do not add a `--once` check inside the merge tick itself; if you find yourself writing one, the wiring point is wrong.

**D4 — the `Merger app` hold has no domain-side plumbing today; this slice has to build the read, not just the arm.** Confirmed by grep: `MergeRefusal` in `merge.ts` has no `merger-app-missing` variant, `ports/host.ts` has no method for "is a Merger app declared," and nothing in `packages/domain` or `packages/fleet` reads this signal. The only place it exists today is shell-side: `skills/plot/scripts/plot-host.sh`'s `pr-merge` arm (around line 4441) resolves a Merger-app token through `plot-merger-token.mjs`, and that script exits 5 (with a stderr notice) when no key is declared, falling back to merging as the signed-in `gh` identity — which on this repository holds `bypass_mode: always` under ruleset 24412719, exactly the bypass D4 exists to close. On GitHub, the merge arm must answer `hold('merger-app-missing')` whenever that key is undeclared, and on Bitbucket this check does not apply at all (the key has no Bitbucket equivalent — `docs/review-status-rollout.md` draws this line already for the push/merge pair). The most direct shape: a small config/port read (parallel to how `Auto-review`/`AUTO_REVIEW_KEY` is read in `auto-review.ts`, or a direct check mirroring what `plot-merger-token.mjs` already does) that the tick passes into the readings record as a boolean or similar, consumed by the merge arm before it ever answers `merge`. Keep the actual merge call itself backend-agnostic — `mergeAt` already shells out through `scripts.hostSaid`, which is where the real Merger-app token resolution continues to happen on the GitHub side; this hold is what stops the *tick* from even trying when the repo hasn't declared one, not a re-implementation of the token minting.

**`HoldReason` is an open string union — `merger-app-missing` and the five other reasons above are free additions, not a type change elsewhere.** `rules/slice-pr-next.ts:65-75` already ends the union with `| (string & {})`.

### Done when

The plan's `## Done when` is the Notes section's test list (the plan has no separate `## Done when` heading — read Notes as the spec):

- `merge()` refuses the three panel-probed cases — these are slice 1's tests and should already be green; this slice does not need to re-add them, only must not break them.
- **The stale row holds `default-branch-stale` on a fixture where `defaultBranchRed` answers `false` on that same fixture.** This is the one test that proves the merge arm's stale check is independent of `defaultBranchRed`, not a thin wrapper around it.
- **Two mergeable PRs in one pass produce exactly one `pr-merge` (i.e. one `mergeAt`) call.** Proves `nextMerge`'s one-per-pass selection, not just that it returns one candidate.
- **A pass that runs right after a merge, with an unchanged `defaultBranch` reading but a moved tip, merges nothing.** This is the lag scenario from Motivation point 2 — the `merge-in-flight` hold (keyed off `newestMerged`) must catch it even though the on-disk reading hasn't refreshed yet.
- **`--once` merges nothing.** Write this as an actual test exercising the `--once` path if one doesn't already exist for the automatic-writes composition, rather than relying on code inspection.
- **The CI spawn ratchet count (`scripts/check-host-cli-callers.sh` / "One place reaches a process", `ci.yml`) does not grow.** This slice is pure domain/fleet TypeScript; no new shell script and no new direct `spawn`/`execFile` site outside `adapters/` should appear. If your merge-tick wiring needs a new host call, it must go through the existing `Host` port/adapter, not a new shell invocation.

Plus the repo's standing gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps your changed files to the relevant `vitest`/`tsc` suites and gate scripts; do not run the full `test:e2e` suite locally (CI's job, not a local one, per CLAUDE.md's Testing section). Since this touches `packages/domain/src/**` and `packages/fleet/src/**`, expect `pnpm --filter @plot-pm/domain exec vitest related --run` + `tsc --noEmit`, and the `@plot-pm/fleet` equivalents, to be in that list. A changeset is needed (`'plot': patch` or `minor` per the size of the change — this reads as a `minor`, "new patterns, expanded coverage" per CLAUDE.md's Versioning section) with the description first and any `bumps:`/`plan:` block last; the `plan:` line, if used, should point at this plan's path.

### Bookkeeping

Open the PR through `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create` directly (it would title the PR from the last commit subject, which is routinely uninformative on this repo). Annotate the plan's slice line with `→ #<PR number>` once opened, matching the `→ #2931` annotation already on the first slice.

### Scope guard

This slice is exactly: the merge and hold arms of `slicePrNext` (replacing the `mergeArm` stub), `nextMerge`, the merge tick's wiring into `fleetAutoWrites`, the in-memory no-retry-at-same-head state, and the `Merger app` read/hold for D4. It is **not**: changes to `merge()`/`mergeAt` itself (slice 1, already merged — only call it), the reviewer/fixer/unblocker arms (other plans in the story), the repair-PR exception to the red hold (#2904, `feature/merge-admits-the-repair-pr`), the run-log lines for a merge/hold or the idle-slice rule (#2899), or the slice-progress comment update after a merge (#2905, which reads MERGED rows independently). If implementing this slice reveals a real gap in one of those owned-elsewhere areas, name it in the PR description rather than filling it here.
