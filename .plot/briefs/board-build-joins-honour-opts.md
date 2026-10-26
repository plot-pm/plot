## Implementation brief — board-status-banner-offline-tickets-and (wave: Shared build)

- **Plan (canonical):** [docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md](../../docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Branch:** `bug/board-build-joins-honour-opts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review required on `main` since 2026-10-15)

This slice has no `waits:` annotation and touches `fleet-state.ts` alone (slice 2, `bug/board-offline-tickets-age-and-rows`, is the one that waits on slice 1 and shares `fleet.ts` with it). Nothing here needs to wait for another slice in this plan.

### What to build

Issue #2097: `boardState` in `packages/board/src/server/controllers/fleet-state.ts:89-153` coalesces concurrent `/api/board` builds into one `buildBoard` call — but the in-flight promise (`fleet-state.ts:89`, `let inFlight: Promise<Board> | null = null;`) is keyed by nothing. Three gaps follow from that:

1. **Not opts-keyed.** Two concurrent callers with *different* `opts` (different `repoRoot`, different injected ports) currently share the same `inFlight` build anyway, because nothing distinguishes them. Only calls using `realEstateSource` join `inFlight` today (`fleet-state.ts:144`), but among those, every one joins regardless of `opts`.
2. **No post-change start.** A joiner that arrives *after* something changed (e.g. a ref moved) during an in-flight build still gets that stale in-flight promise's answer instead of triggering its own fresh build.
3. **No all-reject on failure.** `buildBoard(opts).finally(...)` only clears `inFlight` on settle — it doesn't change the reject/resolve semantics, so this one may already be fine, but the plan explicitly calls out "a failed shared build rejects every joined caller" as a behavior to assert, not assume. Prove it with a test (a rejecting `buildBoard` mock, two concurrent callers, both must reject) rather than taking the current `Promise.finally` plumbing on faith.

### The decisions the plan settles — do not re-derive them

**Key `inFlight` on the opts, not on nothing.** The current single module-level `Promise<Board> | null` conflates "two tabs polling the same repo" (should share) with "two different estates" (must never share — and already don't, via the `estate === realEstateSource` guard). Replace the single slot with a map keyed by whatever in `opts` identifies the estate being built (at minimum `repoRoot`; check whether `refs`/`trees`/other injected ports in `BuildBoardOptions` also need to participate in the key — a fixture `Refs` object can't be used as a map key directly, so the key must be a derived string/tuple, not the opts object itself). The existing `estate === realEstateSource` check stays: a mock estate still never joins any shared slot, keyed or not.

**"Started after the triggering change" is about staleness, not opts identity.** This is the one piece of judgment the plan leaves open (see Open Questions in the plan, item 2, which is about `planEstate` caching in slice 4 — a parallel but separate once-per-head concern). For this slice: if a build is in-flight and a caller's request opts indicate something changed since that build *started* (the plan doesn't specify the exact signal — look for whatever "change" hook triggers board refreshes elsewhere in `board.ts`, e.g. a head-change detector), the joiner should not just await the stale in-flight promise — it should trigger (or wait for) a fresh one. If no such signal already exists in the codebase to reuse, say so in the PR rather than inventing a new one from scratch; this is exactly the kind of scope creep the plan's Open Questions section is flagging as undecided.

**Existing test file to extend, not replace.** `packages/board/test/unit/board-state-coalesces-concurrent-builds.test.ts` already has three cases: shares one build across concurrent real-estate callers, runs a fresh build once the prior one settled, never shares across a mock estate. The plan says "the coalescing test asserts these cases and drops the reference-equality comment" — meaning:
- Add cases for: different-opts callers never share a build (opts-keying), a joiner after a triggering change gets a fresh build, and a failed build rejects every joined caller.
- Drop the `// A fresh object per call, so two concurrent callers can be checked for reference equality` comment at line 26 — the plan calls this out specifically, so it's a known removal, not a judgment call to make fresh.

**`.finally(() => { inFlight = null; })` becomes per-key cleanup.** Once `inFlight` is a map, the cleanup callback must delete only its own key, not reset a single shared slot — getting this wrong reintroduces the single-build-for-everyone bug under a different name.

### Done when

The plan's `## Done when` is not written as a separate list in this plan (it uses the Changelog as the done-state: "a joined board build uses its caller's options and starts after the triggering change, and a failed shared build rejects every joined caller"). Treat that Changelog line as the spec. In addition:

- The three new/updated test cases above pass, and the three existing ones in `board-state-coalesces-concurrent-builds.test.ts` still pass unmodified in intent (same coalescing guarantee for same-opts callers).
- `mockCards`/column-replacement behavior (`fleet-state.ts:103-105`, `boardState`'s `estate.columns` call) is untouched — this slice is scoped to the `inFlight` keying and lifecycle, not the estate substitution seam.
- No change to `EstateSource`, `FleetStateQuery`, or `FleetStateAnswer` shapes — the fix lives inside `boardState`'s body.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` from the repo root before each push, and run what it prints — for `packages/board/src/**` that includes `pnpm --filter @plot-pm/board exec vitest related --run {changed}` and `pnpm run typecheck`. The `CI suites` config key's suites (`test:e2e`, `test:contracts`, `test:board`, domain vitest+coverage, `test/reconcile/*.test.mjs`) run in CI only — do not run them locally as a matter of course (see CLAUDE.md `test:e2e IS CI'S GATE, NOT A LOCAL ONE`).

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR through the controller once the branch has a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, once claimed
```

It reads this plan, titles the PR from the "Shared build" wave heading, and links the plan and this brief in the body. Do not run `gh pr create` directly. Push the first real commit as soon as it exists — an empty claimed branch with no commit for a long stretch reads as a stalled desk.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`### Shared build` subsection, the `bug/board-build-joins-honour-opts` line) — the same pattern already applied to the `PR status` and `Offline tickets` slice lines above it in the plan.

### Scope guard

**Owns:** `packages/board/src/server/controllers/fleet-state.ts` and `packages/board/test/unit/board-state-coalesces-concurrent-builds.test.ts`. No other file in the plan's five slices touches `fleet-state.ts`.

**Collisions, verified against the plan's `## Slices` section:**
- `bug/board-status-banner-states` (slice 1, PR status) touches `packages/domain/src/rules/pr-status.ts` and `host-notes.ts` — disjoint.
- `bug/board-offline-tickets-age-and-rows` (slice 2, Offline tickets) touches `offlineIssueRowsInto`, `issue-offline-fallback.ts`, `CLAUDE.md` — disjoint, but it DOES share `fleet.ts` with slice 1 per the plan's own note ("The slices touch disjoint files except `fleet.ts` (slices 1 and 2)"). This slice (3) is not part of that overlap.
- `bug/board-estate-runs-once-per-head` (slice 4, Estate cost) touches `isClean`, `planEstate`, `planAuthors` — disjoint.
- `bug/board-client-fetch-bound-and-click` (slice 5, Board client) touches `App.tsx`, `planFileFromFleet`, `planLinkClick` — disjoint.

If anything beyond `fleet-state.ts` and its test needs to change to satisfy the Changelog line, report it rather than expanding scope — the plan's file list above is what dispatch and merge-queue planning already assumed when slicing this wave.
