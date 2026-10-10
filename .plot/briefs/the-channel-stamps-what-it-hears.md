## Implementation brief — the-channel-closes-its-review-findings (wave: Channel heartbeat and inputs)

- **Plan (canonical):** [docs/plans/2026-10-10-the-channel-closes-its-review-findings.md](../../docs/plans/2026-10-10-the-channel-closes-its-review-findings.md) on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1497 merged
- **Branch:** `bug/the-channel-stamps-what-it-hears` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per `## Plot Config` — `Review: pr`)

This wave runs after **Default-branch reading age** (`bug/a-stale-default-branch-reading-holds-nothing`) only in the sense that both may touch `packages/domain/src/index.ts`'s export list — they share no other file, so this branch does not block on that one merging first. **Fleetd wiring tests** (`bug/the-fleetd-wiring-has-tests`) follows this one: it tests `index-monitor.ts`, which this wave changes.

### What to build

Four fixes, all in the channel/index/desk-relay path, none overlapping in file:

1. **`packages/fleet/src/shared/pr-refresh.ts` — a merged PR's `mergedAt` must not move once set.** `storeRow` (`:1073-1101`) writes `row.mergedAt = pr.mergedAt` unconditionally whenever the host answers a non-empty string (`:1092`). On Bitbucket, `mergedAt` is read from `.updated_on` (`plot-host.sh:4361`, `:4373`) — a field that changes on every comment, not just the merge. A comment on a PR merged three days ago moves the stored `mergedAt` to now, and `indexFindings` (`packages/domain/src/rules/index-findings.ts:58-62`, `:104`) reads the change as a fresh merge and republishes `pr merged`. Verified live on this branch: `storeRow` still has no predecessor check on `mergedAt` — only `headSince` reads `predecessor` (`:1096-1099`). **Fix:** once `predecessor.mergedAt` is set, keep it; a `MERGED` row is terminal (CLAUDE.md § "One Answer To Did This Land").
2. **`packages/fleet/test/unit/desk-relay.test.ts` — the fixture must make the arms disagree.** The test `'shares one slot between two desks and lets the newest measuredAt win'` (`:200-210`) lists the newer desk (`/w/b`, `measuredAt: '...T10:00:00Z'`) before the older one (`/w/a`, `'...T08:00:00Z'`). `desk-relay.ts:66` does take the newest by `Date.parse` comparison, but because the loop evaluates desks in listed order and the newer one is listed first, a "first-desk-wins" mutant (taking whichever desk is iterated first, ignoring the comparison) would also pass this fixture. List the **older** desk first so the correct behavior (newest wins) and the broken behavior (first wins) disagree. [[mutation-test-fixtures-must-make-arms-disagree]] — this is exactly that pattern.
3. **`packages/board/src/server/findings.ts` — `findingsInLog` duplicates `logTail`.** `findingsInLog` (`:42-62`) does its own `fs.openSync`/`fs.fstatSync`/`fs.readSync` tail read, byte-for-byte the same truncation logic as `desk-fs.ts:59`'s `logTail` — both exist only because the board's payload-build caller needs the read synchronous and `logTail` (used at `desk-fs.ts:293`) is presumably async-compatible or already used elsewhere asynchronously. Check whether the caller of `findingsInLog` can in fact `await` a promise; if so, replace the duplicate with a call through `logTail` and drop the local read. If not — if the synchronous constraint is real — leave it, but say so explicitly in the PR body, because `packages/board/test/unit/findings-parity.test.ts` is the only thing holding the two copies in sync and a silent future edit to one and not the other breaks parity with no compiler error.
4. **No code change needed for #1465 M2 or L2 — both are already fixed on `main`.** Verified while drafting this brief, so the implementer does not re-derive this: `channel-socket.ts:201-205`'s `publish` already stamps `lastSeen` with `now()`, not `measuredAt`, and `channel-socket.test.ts:200-220` already asserts this with an old-`measuredAt` fixture. `index-monitor.ts:61`'s `runIndexMonitor` already calls `world.channel.seen('IndexMonitor')` whenever `index !== null && sliceBranches !== null` — it does not gate on `sliceBranches` being non-empty, so a repo with no slice branches (`sliceBranches` is an empty `Set`, not `null`) is already read as live. **Do not re-implement either; if a test for one of these is missing, add the test only.**

### The decisions this brief settles — do not re-derive them

- **#1465 M2 and L2 are closed, not open.** The plan's Design section (written 2026-10-10 against `eb4bda159`) lists them as findings to fix. Reading the code on this branch's base shows both already hold the described-as-missing behavior. Treat the plan's issue list as the historical record of what review found, not as a live TODO — verify against current code before implementing, the way this brief did.
- **The desk-relay fixture fix is a test-only change.** `desk-relay.ts:66`'s comparison logic (`Date.parse(f.measuredAt) > Date.parse(rival.measuredAt)`) is already correct. Nothing in `desk-relay.ts` needs editing for #1467 M2 — only the fixture's desk order in the test.
- **`mergedAt` is the only field in `storeRow` that needs a predecessor check for this wave.** `headSince` already has one (`:1096-1099`, for a different reason — tracking how long the head has been unchanged). Do not generalize the predecessor pattern to other fields (`updatedAt`, `checksSha`, etc.) — nothing in the issue list asks for that, and CLAUDE.md's "Answers, never verdicts" section is specifically about `mergedAt`'s terminal property, not about every field freezing.

### Done when

The plan's `## Done when` is implicit in its `## Slices` row for this branch: *"a test pins `publish`'s `lastSeen` stamp, a merged row keeps its first `mergedAt`, the IndexMonitor reports itself with no slice branches, the relay test puts the older desk first, and the board's findings read uses `logTail`"* (#1465 M2, M3, L2; #1467 M2, L1). Concretely:

- `storeRow` keeps a predecessor's `mergedAt` once set, with a test: a stored row with `mergedAt` set, fed a fresh host answer with a later `mergedAt` (simulating a Bitbucket comment bump), keeps the original.
- `desk-relay.test.ts`'s two-desk test lists the older desk first; it still asserts `newer` wins.
- `findings.ts` either delegates to `logTail` or states in the PR body why the synchronous read must stay — either way, `findings-parity.test.ts` keeps passing.
- If `channel-socket.test.ts` or `index-monitor` tests are missing an assertion for the already-fixed behaviors (M2/L2), add the missing assertion only — no production code change for those two.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the touched-package test/typecheck commands and the gate scripts from `## Plot Config` in `CLAUDE.md`. The `CI suites` key's full suites (`test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile`) run in CI on every PR; do not run them locally as a matter of course — `test:e2e` especially is CI's gate, not a local one (CLAUDE.md § Testing).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice touches no `.sh` file, so it should not trip — but if the fix for `findings.ts` requires any shell-script change (unlikely), that growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the branch exists and carries a commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch, once pushed
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` — the controller reads which plan names the branch and titles the PR from the wave heading. Push the first real commit as soon as it exists — a branch with no commit refuses `plot-open-pr.sh`. Once the PR exists, append `→ #<number>` to this branch's line under `### Channel heartbeat and inputs` in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/fleet/src/shared/pr-refresh.ts`, `packages/fleet/test/unit/desk-relay.test.ts`, `packages/board/src/server/findings.ts`, `packages/domain/src/adapters/channel/channel-socket.ts` (test only), `packages/fleet/src/shared/index-monitor.ts`, `packages/fleet/src/shared/pr-refresh.ts`'s own tests, and any new test file for the already-fixed M2/L2 behaviors.

Other branches in this plan, verified at brief-writing time (none pushed yet — all seven slices are unclaimed):

- `bug/a-stale-default-branch-reading-holds-nothing` — `packages/domain/src/rules/default-branch.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `plot-host.sh` or `build-jenkins.ts`, `registryd-main.ts:805-811` only.
- `bug/the-fleetd-wiring-has-tests` — `registryd-main.ts` (the rest of it), `fleet-clock.ts`, `registryd-main.test.ts` / `registryd-wiring.test.ts`. Reads `index-monitor.ts` after this wave changes it.
- `bug/the-brief-writer-row-reads-the-rule`, `bug/the-board-builds-the-default-branch-reading`, `bug/the-page-hears-the-last-event`, `bug/the-mod-follows-after-a-reload` — no file overlap with this wave.

If anything in `storeRow`, `desk-relay.ts`, `findings.ts`, `channel-socket.ts` or `index-monitor.ts` looks wrong beyond what's listed here, report it rather than improvising outside scope — in particular, do not touch `default-branch.ts` or `registryd-main.ts`; those belong to the other two branches above.
