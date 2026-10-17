## Implementation brief — fleetd-tick-stop-and-escalation-defects (wave 1: tick guard and escalations)

- **Plan (canonical):** `docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/fleetd-tick-guard-and-escalations` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub, gated by the `plot-review` app

First wave of six. Nothing in this plan waits on it to merge, but the plan's own open question says slice 2 (`bug/fleetd-stop-starts-no-agent`) waits on this one if they collide on the tick file — check that before you claim slice 2.

### What to build

Four defects, all in `packages/fleet/src/server/entry/registryd-main.ts` and `packages/fleet/src/shared/escalations.ts`, closing issues #1306, #1580, and the still-open bullets of #1456 and #1508:

**#1306 — `notifyEscalations` runs outside the tick's own failure guard, and `EscalationMemory` never prunes.** `registryd-main.ts:2252-2292` wraps `runTick` in try/catch — a tick that throws is reported and the loop continues. `notifyEscalations` is called at `:2319`, **after** that catch block has already closed, with no guard of its own. If the notifier rejects (a channel send that throws rather than resolving `{ok: false}`), it is an unhandled rejection that the loop-level guard at `:2252` cannot catch, because it already ran and returned. Guard the call. Separately, `escalationMemory()` (`escalations.ts:143`) returns `{records: [], appendFailureReported: false}` and `notifyEscalations` only ever pushes to `records` (`registryd-main.ts:1301`) — nothing removes an entry, so a long-lived daemon's in-memory list grows for the life of the process. Bound it.

**#1580 — does an empty, freshly-created `fleetd.log` count as a fresh tick?** This is the plan's own open question, not yet answered. `plot-fleetctl.sh:507` (`tick_age_seconds`) already falls back from an empty-or-stale `fleetd.log` to the older `registryd.log` by comparing mtimes — written for exactly this shape, per the comment at `:502-506`. Before changing anything, confirm whether that fallback still leaves a gap: a daemon that has just started, written nothing to either log yet, and whose `fleetd.log` exists but is zero bytes. Decide what that reads as — no tick yet, not a stale one — and say so in the plan or a comment before coding against it. `rules/supervisor-reading.ts:270-291` (`tickStale`) is the domain side of this and already treats an absent or non-finite age as "says nothing," not stale; check whether that's sufficient or whether the empty-log case needs its own test fixture.

**#1456 L2 and #1508 L2 — `Checks wait` is read from config twice per tick instead of once.** `registryd-main.ts:823` and `:2142` each call `readConfigAsync({ repoRoot, scriptsDir }, 'Checks wait', '3600')` independently — one inside `defaultBranchRed`'s closure (used by the queue-holds world), one inside the PR-refresh world setup. Each `readConfigAsync` call is a process spawn (`plot-config.sh`). Read it once per tick and pass the resolved value to both call sites.

### The decisions the plan settles — do not re-derive them

**#1456's other bullets (M1, L1, L3, L4) and #1508's other bullets (HIGH, M1, M2, L1, L3) are already closed on `main` or assigned elsewhere** — the plan's Motivation section marks both issues "(partial)" for a reason: only the `Checks wait` bullet from each is still open against the tick guard. Re-measure before touching anything else in either issue's thread; the plan explicitly expects slice 1 to drop a bullet `main` has already fixed rather than re-fix it. #1508's L1 is assigned to a different plan (`the-controllers-close-their-review-findings`) and its L3 to `bug/the-fleetd-wiring-has-tests` — do not pull either into this slice.

**The tick's own try/catch (`:2252-2292`) is "defence in depth," not a fix for an observed crash** — the comment at `:2234-2239` says the production path that would hit it is currently empty, corrected 2026-09-23 after a delivery panel refuted an earlier claim that it covered a real death. Don't reopen that argument or cite it as a live incident; the #1306 fix here is about closing a gap in the *shape* of the guard, not about an observed daemon death from this specific cause.

**Rules carried over unchanged.** Absent is not false: `rules/supervisor-reading.ts` treats a missing or non-finite `tickAgeSeconds` as "no reading," never as "fresh" or "stale" by default — follow the same shape if the empty-log decision adds a new signal. Read the exit code, not the emptiness, the same rule `plot-fleetctl.sh:503-504` already states for `tick_age_seconds`.

### Done when

The plan's `## Done when` section is not present as a separate heading in this plan — its Changelog section is the spec for this slice:

- `notifyEscalations` runs inside the tick guard.
- `EscalationMemory` stays bounded.

Lift these into tests that fail before the fix: a test that makes the notifier's `notify()` reject (not resolve `{ok: false}`) and asserts the daemon loop survives and takes its next tick, proving the guard actually covers this call and not just `runTick`. A test that runs many ticks' worth of escalations through one `EscalationMemory` and asserts its size stops growing past some bound, proving the memory doesn't leak over a long-lived process. A test for the `Checks wait` read count per tick (one `readConfigAsync` call, not two) — a mutant that made the second call ignore the cached value and spawn again must fail it.

Plus: build artifacts untouched (`skills/plot/scripts/board/board-server.mjs` is generated — do not hand-edit or commit a rebuild of it; see `docs/definition-of-done.md` if you touch anything near it). A changeset under `.changeset/` naming the fix, per `plot: patch` or `plot: minor` depending on scope — this is a bug fix, so `patch` unless you also touch a changeset-named section. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run the full suite list yourself.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is TypeScript-only unless the #1580 empty-log decision needs a `plot-fleetctl.sh` change — if it does, that growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and reach it through a bundle.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, once there's a real commit
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists — don't hold it until the slice is done.

### Scope guard

This branch owns `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/escalations.ts`, and their tests. It may also touch `skills/plot/scripts/plot-fleetctl.sh` and `packages/domain/src/rules/supervisor-reading.ts` **only** if the #1580 decision requires it — check first whether the existing fallback already closes the gap before editing either.

The other five branches in this plan: `bug/fleetd-stop-starts-no-agent` (stop path — the scan after-step, `wt_root` resolution, stop-race tests — same file, different functions; coordinate if you both touch `registryd-main.ts`'s tick loop), `bug/fleetd-once-and-channel-output` (`--once` output, channel retry/newline), `bug/fleetd-unit-harness-findings` (#1589 review findings), `bug/fleetd-retries-usage-limit-brief` (usage-limit retry), `bug/refused-hold-names-its-reason` (domain + fleetd + board, #1642). None of them are claimed yet as of this brief; verify at dispatch time, not from this list, since branches get claimed as agents pick them up.

If you find something the plan did not anticipate — especially on the #1580 decision, which the plan deliberately leaves open — report it rather than improvising scope.
