## Implementation brief — a-board-or-fleetd-older-than (wave 2: Spawner Status)

- **Plan (canonical):** [docs/plans/2026-10-26-a-board-or-fleetd-older-than.md](../../docs/plans/2026-10-26-a-board-or-fleetd-older-than.md) on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2729 merged
- **Branch:** `bug/the-board-and-fleetd-report-their-contract` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This is the plan's second and last wave. It waits on `bug/a-spawn-carries-its-gate-contract`, merged as PR #2751 — `SPAWN_CONTRACT`, `spawnContractEnv`, `spawnContractReading` and `plot-gate.mjs --spawn-contract` all already exist on `main`. Nothing waits on this branch.

### What to build

Slice 1 gave the gate a number to compare against and a refusal text that names a skew. This slice gives the board and fleetd a way to *report* their own number against the gate's, so an operator sees staleness before it produces a refusal — the #2728 incident was found only after a worker already failed. Nothing here starts, stops, kicks or reloads a process; it is read-only, end to end.

Three things, in order:

1. **A gate-number reader.** Resolve the gate Claude Code loads for this repo: the `plot@*` entry in `~/.claude/plugins/installed_plugins.json` with `scope: "project"` and `projectPath` matching the repo root; else the `user`-scope entry; else the repo's own `skills/plot/scripts/board/plot-gate.mjs`. Run `node <gate> --spawn-contract` (already wired at `packages/board/src/server/entry/gate.ts:781`, printing `SPAWN_CONTRACT` and returning `EXIT.allow` — it was added in slice 1 for exactly this caller) and cache the answer by the gate file's size and mtime. No answer → `unknown`.
2. **The board reports it.** Hold the board's own compiled `SPAWN_CONTRACT` and its bundle's content hash at start; serve both plus the gate number in the `/api/board` payload (`packages/board/src/contract/schema.ts`, `packages/board/src/server/board.ts`). Render it as a `BoardStatus` entry (the interface at `packages/domain/src/rules/default-branch.ts:272-291` — `key`, `severity`, `text`, `tone`, optional `notices`) beside the existing `checkoutHealthStatus` entry in `packages/board/src/app/components/AgentList.tsx:945`. `skills/plot/scripts/plot-boardctl.sh --status` prints the line from the `/api/board` body it already fetches (`:206`) — no new network call.
3. **fleetd reports it.** fleetd writes `.plot/state/fleetd-start.json` under the common git dir once at start: `pid`, `startedAt`, `spawnContract`, `bundlePath`, `bundleHash`. fleetd's entry point (`registryd-main.ts`) is the one writer — model the single-writer test on `one-issue-index-writer.test.ts` (`packages/fleet/test/unit/one-issue-index-writer.test.ts`), which already holds the same shape for `issues.json`. `skills/plot/scripts/plot-fleetctl.sh --status` prints the line that a new `plot-ask.mjs spawner` answer derives from that file. A file whose `pid` doesn't match the running supervisor's pid reads `unknown`.

### Decisions the plan settles — do not re-derive them

**Report only, never a restart.** The Open Questions log records this as a decided operator call from panel round 1: a restart would stop agents mid-work and nothing today gates an unattended restart, so the plan deliberately stops at reporting. Do not add a self-restart, a `--stop` suggestion in the status line's main text, or any process action triggered by a stale reading. The plan is explicit: "No consumer of the reading starts, stops, kicks or reloads a process."

**Three words only: `current`, `stale: spawn contract N, gate expects M`, `unknown`.** Equal numbers → `current`. Different numbers, in either direction → `stale`, with both numbers always printed (never just "different" or "mismatch"). No recorded identity, a pid mismatch, or a gate that doesn't answer → `unknown`. Don't collapse `stale` into a boolean or drop the numbers from the text — the whole point of the incident is that nobody could tell *how* stale, in which direction.

**A stale line names what a restart would stop, but suggests nothing.** For the board: the runs it started. For fleetd: the agents it runs. State the fact; recommend a restart only when those are idle, and even then, name it as a recommendation in prose, not as an action this code takes.

**Bundle drift is evidence, never `stale`.** Only a different `SPAWN_CONTRACT` number is `stale`. A content-hash difference between the running bundle and the one on disk now prints as `bundle differs from <path> (evidence, not the verdict)` — a separate line, separate tone, never folded into the `stale`/`current`/`unknown` word. This is why the plan keeps the number and the hash as two separate fields rather than one. Reuse `refs.hashFilesSync` the way `worker-loop.ts:362-363` already does for `loop-restart.ts` — don't write a second hashing routine. Re-hash only when size or mtime changed, same cheapness the existing loop-restart check relies on.

**`plot-fleetctl.sh --status`'s exit code and `summary:` line are frozen.** `supervisor-reading.ts` parses the `summary:` line, including the `supervisor=` word (`plot-fleetctl.sh:971`) — adding the spawner line must not change that line's shape or the exit code. Add the spawner-status line as an additional line in the same status block, not a replacement.

**The `BUNDLE MISSING` shell arm moves, it doesn't duplicate.** `plot-fleetctl.sh:827-828`'s shell check for a missing bundle file is superseded by the same `plot-ask.mjs spawner` answer (bundle drift is part of what that answer now reports) — remove the shell arm rather than leaving two paths that can disagree. This is also required by the line-budget below.

**Known blind spots — don't try to close them, the plan accepts them.** A session started with `--plugin-dir` or another `CLAUDE_CONFIG_DIR` can't have its loaded gate resolved by this reader; it reads as whatever the three-tier lookup above lands on, which may be wrong for that one session. A session that loaded the plugin before an update keeps reading its old gate for its own lifetime — the status line names the gate path it compared against, specifically so an operator can see *which* gate was read and judge for themselves, rather than this code trying to detect that case.

### Done when

The plan's `## Done when`-equivalent is its Acceptance section for Slice 2 and the shared "Both" bullet — read both in full before starting. Pulled out because a naive implementation passes without them:

- With the slice's fleetd and board running and a gate bundle whose number differs, `plot-fleetctl.sh --status` and `plot-boardctl.sh --status` each print `stale: spawn contract N, gate expects M` — the exact numbers, not a placeholder — and the board page shows the status entry. With equal numbers both print `current`. On `origin/main` today neither prints any spawn-contract line at all, so a correct implementation must change that baseline, not just add a code path that never fires.
- `--status` on both scripts keeps its existing exit code and its existing `summary:` line verbatim.
- Domain: `spawnerStatus` answers `current`, `stale` for N < M and for N > M (both directions — test both), and `unknown` for a missing record, a pid mismatch, and a gate that does not answer. Bundle drift with equal spawn-contract numbers gives the evidence line and explicitly no `stale`.
- No-action test: the board status read and `plot-ask.mjs spawner` with a stale reading make zero calls on a fake processes port — this is what proves "report only" rather than just asserting it in prose.
- fleetctl contract test (`test/reconcile/`): a fixture `fleetd-start.json` prints the stale line, keeps exit code 0 and the same `summary:` line as the no-record fixture, and prints `unknown` with no record. A plugin fixture with `cache/<old>/` and `cache/<new>/` gate bundles of different numbers reads `stale`.
- `./scripts/check-shell-lines.sh` and `./scripts/check-decision-count.sh pr` pass. This slice adds the `plot-ask.mjs spawner` call to `plot-fleetctl.sh` and one print to `plot-boardctl.sh`, and must remove the shell `BUNDLE MISSING` arm (`plot-fleetctl.sh:827-828`) plus enough other lines to at least break even — the shell-lines gate is a ratchet against the merge base, not a one-time allowance.
- The comparison logic lives in a bundle (the domain rule plus a thin script caller), not inline shell, so no row in `skills/plot/scripts/README.md` changes its `Kind` column.
- A changeset for package `plot`, description = this slice's Changelog line from the plan (`The board and fleetd report "stale: spawn contract N, gate expects M" in --status and on the board when their spawn contract differs from the gate's, and change no process.`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests that name your changed files, the related tests and typecheck of whichever package you touched (`@plot-pm/board`, `@plot-pm/fleet`, `@plot-pm/domain` are all in scope here), and the gate tests and `scripts/check-*.sh`. The suites in the repo's `CI suites` config key run in CI on every PR; don't run `test:e2e` locally — it's CI's gate, not a local one (see CLAUDE.md Testing section).

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan and brief into the PR body and sets the title from the plan's wave heading. Push the first real commit as soon as it exists — a sprint's worth of finished work with no PR raised is exactly the failure mode the controller exists to prevent.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/the-board-and-fleetd-report-their-contract` line under `### Spawner Status`).

### Scope guard

This branch owns:
- `packages/domain/src/rules/spawn-contract.ts` (extending it with `spawnerStatus` and `BUNDLE_SHAPE`/hash helpers as needed — read it first, it's small)
- `packages/board/src/contract/schema.ts`, `packages/board/src/server/board.ts` (the `/api/board` payload)
- `packages/board/src/app/components/AgentList.tsx` (one new status entry beside `checkoutHealthStatus`)
- `packages/fleet/src/shared/registryd-main.ts` or equivalent fleetd entry (the `fleetd-start.json` write)
- `skills/plot/scripts/plot-boardctl.sh`, `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot/scripts/board/plot-ask.mjs` (new `spawner` subcommand)
- `skills/plot/scripts/README.md` (row updates only if a `Kind` or description changes — it should not)

`bug/a-spawn-carries-its-gate-contract` is already merged (#2751); nothing else is in flight against this plan. If something outside this list needs to change to make the above work, that's new information the plan didn't anticipate — report it rather than improvising past scope.

If the plan did not anticipate something you find while building this, report it rather than improvising outside scope.
