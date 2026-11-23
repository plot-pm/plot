## Implementation brief — fleet-state-is-read-whole-and-from-one-home (wave 5: One state home)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/every-state-reader-asks-one-state-home` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

Waves 1 to 4 have merged (#3624 `StateHome`, #3659 `repairStartAction`, #3666 the re-run bound, #3669 `state-home-unread`). Waves 6 to 8 wait on this one in heading order.

### What to build

Slice 1 put the four `.plot/state` file adapters of the merge path on a branded `StateHome` and added `stateHomeOf`, `stateHomeAt` and `stateHomeAtSync`. Five other resolvers still ask `mainRootOf` (`packages/domain/src/adapters/main-checkout.ts:22`), which answers the input path where git cannot name the main checkout. A caller then reads or writes `.plot/state` under a linked worktree or an unrelated directory, finds nothing and carries on. Measured 2026-11-06 from `.worktrees/scratch-sprint-add`: the same call answered `no-open-episode` there and `named:true` in the main checkout. This branch moves every main-checkout resolver onto the one rule and deletes `mainRootOf`.

Build, in this order, each step green before the next:

1. **Bridge and heartbeat paths take a `StateHome`.** `bridgePath` (`adapters/fleet-state/fleet-state-file.ts:35`), `fleetdHeartbeatPath` (`adapters/fleetd-heartbeat/fleetd-heartbeat-file.ts:18`), `readFleetdHeartbeatSync` (`:66`), `fleetdHeartbeatFile` (`:33`) and `fleetStateFile`/`FleetStateFileOptions` (`:106-129`) change `repoRoot: string` to `home: StateHome`, so `tsc` names every caller. `fleetStateVouched(repoRoot)` stays the convenience entry and resolves with `stateHomeAtSync(repoRoot)` itself.
2. **Unread-home behaviour, per the plan's table.** Bridge read: no pulse, `answered(null)`, so continue, restart and dispatch refuse `no-pulse`. Bridge write: `failed`, and fleetd logs `bridge write refused` (`fleet-clock.ts:204`). Heartbeat read: no heartbeat, so no live fleetd. Heartbeat write: `failed`. Use the `unread*` store pattern of `packages/board/src/server/state-home.ts` where an adapter needs a store over no file.
3. **`recordBridge`** (`packages/board/src/server/entry/pulse-log.ts:75`) resolves with `stateHomeAtSync` and writes nothing where the home is unread.
4. **`processes-files.ts:430,505`** and **`approve.ts:1394`** (`mainRootOf(ctx)` over `ctx.trees.mainRoot`) keep the fallback to `repoRoot`, per the plan's table: they list processes, read scripts and append `in-session-approvals.tsv`, and write nothing a gate reads. Move them off `mainRootOf` and name the fallback at the call site.
5. **`design.ts`, `verify.ts` and `review.ts`** keep today's `refsGit.repoRoot()` probe, taken after `stateHomeAt`. Read each call site (the plan cites `design.ts:281`, `verify.ts:854`, `review.ts:664`; line numbers drift, so find them by the probe) before you change it.
6. **Delete `mainRootOf`** and its export in `adapters/index.ts:238`. Re-point `test/bridge-main-checkout.test.ts` at `stateHomeAtSync`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **`stateHomeAtSync` already exists.** The plan's `builds:` marker names it, but slice 1 shipped it (`main-checkout.ts:48`, cached per root). Do not write a second one. Rejected: an async `stateHomeAt` for the bridge. The bridge and heartbeat reads run in synchronous paths (`readFleetdHeartbeatSync`, `fleetStateVouched().readSync()` in continue, restart and dispatch), and an async change reaches every caller.
- **Both adapters realpath.** `stateHomeAt` and `stateHomeAtSync` agree on the answer. A symlinked checkout that one resolves and the other does not splits the home, which is the defect itself.
- **The unread-home behaviour is the plan's table, not a choice.** `unread` never falls back to `repoRoot` for the bridge or the heartbeat: a gate reads both. The three callers that keep the fallback are the ones the table names, because nothing a gate reads lives there.
- **Scope is the main-checkout home only.** The common-dir stores (PR index, issue index, reader lock) stay where they are.
- **The bridge keeps `BRIDGE_VERSION` 1 with no `complete` field** (operator decision 2026-11-21). Wave 6 handles the partial pulse. Do not touch the record's shape here.
- **Open question for you to report, not to fix here.** `ctx.trees.mainRoot` (`trees-git.ts:776-779`) answers `path` where the common dir is not `.git`, and `brief-book.ts:167`, `needs-design.ts:457`, `record-pr.ts:145`, `story-status-move.ts:184` and `supersession.ts:356` call it. The plan names only `approve.ts` among them. If a caller writes under `.plot/state` through that fallback, report it in the PR rather than widening the slice.
- **fleetd's `mainCheckout`** (`packages/fleet/src/shared/main-checkout.ts`) is a separate resolver for the lock and implement-state paths. The plan's slice 1 moved fleetd's arms; do not rewrite it unless `tsc` names it.
- **Carried rules:** absent is not false; a failed read is not an absent reading; read the exit code, not the emptiness.
- **Style:** arrow functions for every function you write. TSDoc states what an export does, its parameters, its return and how it fails, with no history. Reasoning goes in the commit message.

### Done when

The plan's `## Slices` entry and `### Approach › Slice 5` are the specification. The assertions that exist because a naive implementation would pass without them:

- `packages/domain/test/fleet-state-file.test.ts`: the bridge of a linked worktree is the main checkout's, and an unread home reads no pulse. The unread cell fails today because `mainRootOf` falls back to `repoRoot`. It catches a port that keeps the fallback.
- `packages/domain/test/state-home.test.ts`: one `// @ts-expect-error` cell proves `fleetStateFile({ repoRoot: '/x' })` is a type error. It catches a signature that still accepts a raw path.
- A heartbeat cell: an unread home answers no heartbeat on read and `failed` on write, and writes no file under the input path. Check the directory, not only the return value.
- A `recordBridge` cell over a directory outside any repository: it writes nothing and returns without throwing.
- The existing tests of each moved caller pass unchanged. `bridge-main-checkout.test.ts` is re-pointed, not deleted; its linked-worktree case must still hold.
- `git grep mainRootOf packages skills` returns nothing outside history.

Plus: add a changeset (description first, `bumps:` block last; package `@plot-pm/board`, and `@plot-pm/domain` only if the repo names it as a package; add `plot` only if a skill changes). The description names the unread-home behaviour. Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: remove shell elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines and has no override. This slice should touch no `.sh` file.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. The changelog already lists the unread-home refusal; do not add a second line there.

### Scope guard

This branch owns `packages/domain/src/adapters/main-checkout.ts`, `fleet-state/fleet-state-file.ts`, `fleetd-heartbeat/fleetd-heartbeat-file.ts`, `processes/processes-files.ts`, `packages/board/src/server/entry/pulse-log.ts`, `approve.ts`, the `design.ts`, `verify.ts` and `review.ts` call sites, `adapters/index.ts`, and the tests above. fleetd call sites change only where `tsc` names them.

Other waves, verified against the plan at dispatch: wave 6 (`the-board-routes-read-a-partial-pulse`) edits `pulse-branch.ts`, `startReadingFromPulses`, the worker log and `plot-fleet-scan.sh:222`; wave 7 (`the-pulse-lookup-moves-into-the-domain`) edits `continue-command.ts`, `restart-command.ts` and the agent panel; wave 8 edits `repair.ts` and `repair-record.ts`. Wave 7 touches the same entry files that call `fleetStateVouched`, so keep its signature. Open PRs outside this plan were not re-checked: if `git diff origin/main` shows a collision at push time, report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
